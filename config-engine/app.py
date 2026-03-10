"""
Config Engine - Flask backend.
Serves config JSON list, get/save, search, import from ZIP, and download JSON.
"""

import json
import os
import re
import shutil
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory, send_file

try:
    from util.zip_import import generate_config_from_zip
except ImportError:
    generate_config_from_zip = None

try:
    from util.test_dataflow import generate_sample_data, run_dataflow_test, run_dataflow_test_stream
except ImportError:
    generate_sample_data = None
    run_dataflow_test = None
    run_dataflow_test_stream = None

app = Flask(__name__, static_folder="static", static_url_path="/static")

# Directory containing config JSON files (can be set via env CONFIG_DIR)
CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", Path(__file__).parent / "configs"))
CONFIG_DIR = CONFIG_DIR.resolve()

# Application settings file (use_llm, path prefix, LLM endpoint, etc.)
SETTINGS_PATH = Path(__file__).parent / "static" / "config" / "settings.json"

DEFAULT_SETTINGS = {
    "use_llm": False,
    "input_output_path_prefix": "s3://migration-bucket/data",
    "input_dataset_prefix": "",
    "output_dataset_prefix": "",
    "llm_base_url": "",
    "llm_model": "qwen2.5-coder:7b",
    "llm_timeout_seconds": 900,  # Increased timeout for larger model
    "config_dir": "",
    "raw_bucket_prefix": "",
    "validation_bucket_prefix": "",
    "error_bucket_prefix": "",
    "curated_bucket_prefix": "",
    "usa_holidays": [
        {"active": True,  "name": "New Year's Day",          "date": "2026-01-01"},
        {"active": True,  "name": "Martin Luther King Jr. Day","date": "2026-01-19"},
        {"active": True,  "name": "Presidents' Day",          "date": "2026-02-16"},
        {"active": True,  "name": "Memorial Day",             "date": "2026-05-25"},
        {"active": True,  "name": "Juneteenth",               "date": "2026-06-19"},
        {"active": True,  "name": "Independence Day",         "date": "2026-07-04"},
        {"active": True,  "name": "Labor Day",                "date": "2026-09-07"},
        {"active": True,  "name": "Columbus Day",             "date": "2026-10-12"},
        {"active": True,  "name": "Veterans Day",             "date": "2026-11-11"},
        {"active": True,  "name": "Thanksgiving Day",         "date": "2026-11-26"},
        {"active": True,  "name": "Christmas Day",            "date": "2026-12-25"},
    ],
}


def _load_settings() -> dict:
    """Load settings from file; return defaults if missing or invalid."""
    if not SETTINGS_PATH.exists():
        return dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        out = dict(DEFAULT_SETTINGS)
        for k in DEFAULT_SETTINGS:
            if k in data:
                out[k] = data[k]
        # If usa_holidays is empty list (old/blank settings), seed with defaults
        if not out.get("usa_holidays"):
            out["usa_holidays"] = list(DEFAULT_SETTINGS["usa_holidays"])
        # Normalize use_llm to bool (JSON or form may send string "true"/"false")
        v = out.get("use_llm", False)
        out["use_llm"] = v is True or (isinstance(v, str) and v.lower() in ("true", "1", "yes"))
        return out
    except Exception:
        return dict(DEFAULT_SETTINGS)


def _save_settings(data: dict) -> None:
    """Save settings to file."""
    out = _load_settings()
    for k in DEFAULT_SETTINGS:
        if k in data:
            out[k] = data[k]
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        _safe_json_dump(out, f, indent=2)


def _get_config_dir() -> Path:
    """Return effective config directory: settings config_dir if set, else CONFIG_DIR from env."""
    s = _load_settings()
    raw = (s.get("config_dir") or "").strip()
    if not raw:
        return CONFIG_DIR
    p = Path(raw).resolve()
    if not p.is_dir() and not p.exists():
        p.mkdir(parents=True, exist_ok=True)
    return p if p.is_dir() else CONFIG_DIR


def _config_path(relative: str) -> Path:
    """Resolve relative path under config dir; forbid path traversal."""
    base = _get_config_dir()
    p = (base / relative).resolve()
    if not str(p).startswith(str(base)):
        raise ValueError("Invalid path")
    return p


def _parse_fixed_width_text(text: str, fields: list, header_count: int = 0, trailer_count: int = 0) -> list:
    """Parse fixed-width text into list of row dicts using field definitions (start/length).

    Skips header_count lines at the start and trailer_count lines at the end.
    Auto-normalizes start positions when a multi-record copybook assigns absolute
    positions beyond the physical record length (e.g. DATA fields at 121+ on 120-byte records).
    """
    lines = [line.rstrip("\r") for line in text.splitlines() if line.rstrip("\r")]
    # Skip header / trailer rows
    if header_count > 0:
        lines = lines[header_count:]
    if trailer_count > 0 and trailer_count <= len(lines):
        lines = lines[:-trailer_count]
    if not lines:
        return []
    # Normalize absolute start positions
    start_adj = 0
    if fields:
        min_start = min(
            (int(f.get("start") or 1) for f in fields if f.get("start")),
            default=1,
        )
        if min_start > 1 and (min_start - 1) >= len(lines[0]):
            start_adj = min_start - 1
    rows = []
    for line in lines:
        row = {}
        for f in fields:
            fname = f.get("name") or ""
            start = max(0, int(f.get("start") or 1) - 1 - start_adj)
            length = int(f.get("length") or 1)
            row[fname] = line[start: start + length].strip()
        rows.append(row)
    return rows


def _safe_json_dump(obj, f, indent=2):
    """Safe JSON dump that converts sets to lists."""
    def _convert_sets(obj):
        """Recursively convert sets to lists for JSON serialization."""
        if isinstance(obj, set):
            return list(obj)
        elif isinstance(obj, dict):
            return {k: _convert_sets(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_convert_sets(item) for item in obj]
        else:
            return obj
    
    json.dump(_convert_sets(obj), f, indent=indent)


def _find_json_files(dir_path: Path, base: str = "") -> list[dict]:
    """Recursively find .json files; return list of {path, name, relative}. Skips test_data dir."""
    out = []
    if not dir_path.exists():
        return out
    for f in sorted(dir_path.iterdir()):
        rel = f"{base}/{f.name}" if base else f.name
        if f.is_dir():
            if f.name == "test_data":
                continue
            out.extend(_find_json_files(f, rel))
        elif f.suffix.lower() == ".json":
            out.append({"path": rel, "name": f.name, "relative": rel})
    return out


@app.route("/")
def index():
    return send_from_directory(app.static_folder or ".", "index.html")


@app.route("/studio")
def studio():
    """Dataflow Studio - advanced draw.io-style editor to build dataflow JSON from scratch."""
    return send_from_directory(app.static_folder or ".", "index.html")


@app.route("/runbook")
def runbook():
    """User Runbook — step-by-step guide for the Config Engine."""
    return send_from_directory(app.static_folder or ".", "runbook.html")


@app.route("/api/settings", methods=["GET"])
def get_settings():
    """Return application settings (use_llm, path prefix, LLM config, etc.)."""
    return jsonify(_load_settings())


@app.route("/api/settings", methods=["PUT"])
def save_settings():
    """Update application settings. Body: { use_llm, input_output_path_prefix, llm_base_url, llm_model, config_dir, ... }."""
    try:
        data = request.get_json(force=True) or {}
        _save_settings(data)
        return jsonify({"ok": True, "settings": _load_settings()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/configs")
def list_configs():
    """List all JSON config files under CONFIG_DIR."""
    try:
        files = _find_json_files(_get_config_dir())
        return jsonify({"configs": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>")
def get_config(filename):
    """Get one config JSON by path relative to CONFIG_DIR."""
    try:
        path = _config_path(filename)
        if not path.exists():
            return jsonify({"error": "Not found"}), 404
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except json.JSONDecodeError as e:
        details = f"Line {e.lineno}, column {e.colno}: {e.msg}"
        return jsonify({"error": f"Invalid JSON: {e}", "details": details}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/test-data", methods=["GET"])
def get_config_test_data(filename):
    """Return persisted input_data and expected_output for this config (from ZIP import)."""
    try:
        cfg_path = _config_path(filename)  # validate path
        td_dir = _test_data_dir(filename)
        td_file = td_dir / "test_data.json"
        if not td_file.exists():
            return jsonify({"input_data": {}, "expected_output": {}})
        with open(td_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Re-parse FIXED format data from raw files using config field definitions.
        # This handles cases where fixed-width files were previously stored as CSV-parsed garbage.
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            cfg = {}
        # Collect all field definitions that look like fixed-width (have start+length).
        # Used later to re-parse stale expected_output keys not in the config's Outputs.
        _all_fw_field_sets: list[list] = []
        for _sec in ("Inputs", "inputs", "Outputs", "outputs"):
            for _ncfg in (cfg.get(_sec) or {}).values():
                if not isinstance(_ncfg, dict):
                    continue
                _flds = _ncfg.get("fields") or []
                if _flds and any(f.get("start") is not None for f in _flds):
                    _all_fw_field_sets.append(_flds)

        for section_key, data_key in [("Inputs", "input_data"), ("Outputs", "expected_output")]:
            section = cfg.get(section_key) or cfg.get(section_key.lower()) or {}
            stored = data.get(data_key) or {}
            for node_name, node_cfg in section.items():
                if not isinstance(node_cfg, dict):
                    continue
                fmt = (node_cfg.get("format") or "").strip().upper()
                fields = node_cfg.get("fields") or []
                # Accept FIXED format, or any format whose fields carry start/length
                # positions (e.g. "delimited" nodes that were actually written as fw)
                has_fw_fields = bool(fields and any(f.get("start") is not None for f in fields))
                if fmt != "FIXED" and not has_fw_fields:
                    continue
                if not fields:
                    continue
                # Check if stored data looks like it needs re-parsing (e.g. single-column CSV garbage,
                # or schema changed since the expected output was uploaded)
                existing_rows = stored.get(node_name)
                needs_reparse = False
                if existing_rows and len(existing_rows) > 0:
                    cols = list(existing_rows[0].keys())
                    # If there's only one column and it looks like a full fixed-width line, re-parse
                    if len(cols) <= 1:
                        needs_reparse = True
                    else:
                        # Check if stored columns match current schema fields.
                        # If schema was updated (e.g. copybook re-imported), stored data
                        # may have stale columns from the old schema.
                        schema_names = {(f.get("name") or "").upper() for f in fields if f.get("name")}
                        stored_names = {c.upper() for c in cols if not c.startswith("_")}
                        if schema_names and stored_names != schema_names:
                            needs_reparse = True
                        # Also detect all-empty values (position normalization bug —
                        # multi-record copybook assigns DATA fields at start=121+ but
                        # physical records are 120-byte lines; all values come back empty)
                        if not needs_reparse:
                            sample = existing_rows[:5]
                            if sample and all(
                                all(str(v or "").strip() == "" for v in row.values())
                                for row in sample
                                if isinstance(row, dict)
                            ):
                                needs_reparse = True
                elif existing_rows is not None and len(existing_rows) == 0:
                    needs_reparse = True  # empty rows, try raw file
                else:
                    needs_reparse = True  # no data at all for this node
                if needs_reparse:
                    raw_text = None
                    # Strategy 1: reconstruct original fixed-width lines from single-column
                    # stored data.  This fixes the common case where a fixed-width file was
                    # imported via ZIP and read by csv.DictReader without field definitions:
                    # the first data line becomes the single column name, and each subsequent
                    # row stores its full fixed-width line as the value under that key.
                    # Recovery: [col_name] + [row[col_name] for each row] = all original lines.
                    if existing_rows and len(existing_rows) > 0:
                        cols = list(existing_rows[0].keys())
                        if len(cols) == 1:
                            header_line = cols[0]  # this IS the first raw data line
                            data_lines = [str(row.get(cols[0]) or "") for row in existing_rows]
                            raw_text = "\n".join([header_line] + data_lines)
                    # Strategy 2: fall back to reading the raw file from disk (e.g. from a
                    # direct file upload via the node-test-file endpoint)
                    if not raw_text:
                        safe_node = node_name.replace("/", "_").replace("..", "_").replace(" ", "_")
                        for prefix in (f"node_{safe_node}", safe_node):
                            for ext in (".dat", ".txt", ".fixed", ".del", ".csv", ""):
                                candidate = td_dir / f"{prefix}{ext}"
                                if candidate.exists():
                                    try:
                                        raw_text = candidate.read_text(encoding="utf-8", errors="replace")
                                    except Exception:
                                        raw_text = None
                                    if raw_text:
                                        break
                            if raw_text:
                                break
                    if raw_text:
                        try:
                            hdr_skip = int((node_cfg or {}).get("header_count") or 0)
                            trl_skip = int((node_cfg or {}).get("trailer_count") or 0)
                            rows = _parse_fixed_width_text(
                                raw_text, fields,
                                header_count=hdr_skip, trailer_count=trl_skip,
                            )
                            if rows:
                                stored[node_name] = rows
                        except Exception:
                            pass
            if stored:
                data[data_key] = stored

        # Re-parse stale expected_output keys that are NOT defined in the config's
        # current Outputs.  These arise when a config is renamed/restructured after
        # the ZIP was imported.  We try every fixed-width field set we collected and
        # use the first one that produces genuinely multi-column results.
        cfg_output_keys = set((cfg.get("Outputs") or cfg.get("outputs") or {}).keys())
        exp_stored = data.get("expected_output") or {}
        changed = False
        for node_name, rows in list(exp_stored.items()):
            if node_name in cfg_output_keys:
                continue  # already handled by the main loop above
            if node_name.startswith("__ctrl__"):
                continue  # ctrl file entries are never raw-text parses
            if not rows or not isinstance(rows, list) or len(rows) == 0:
                continue
            cols = list(rows[0].keys()) if isinstance(rows[0], dict) else []
            if len(cols) != 1:
                continue  # already multi-column — nothing to fix
            # Reconstruct raw lines from single-column stored data
            header_line = cols[0]
            data_lines = [str(row.get(cols[0]) or "") for row in rows if isinstance(row, dict)]
            raw_text = "\n".join([header_line] + data_lines)
            # Try each collected field definition; keep first that yields > 1 column
            for flds in _all_fw_field_sets:
                try:
                    parsed = _parse_fixed_width_text(raw_text, flds)
                    if parsed and len(list(parsed[0].keys())) > 1:
                        exp_stored[node_name] = parsed
                        changed = True
                        break
                except Exception:
                    pass
        if changed:
            data["expected_output"] = exp_stored

        # Auto-remap stale expected keys to the most likely config output key.
        # When a stale key's column names overlap ≥ 60% with a config output's
        # field names, and that output has no expected data yet, we transparently
        # re-key the entry so the reconciliation comparison works without the
        # user having to re-upload.  This is done in-memory only (not persisted)
        # so the original test_data.json is not modified.
        def _norm_col_py(s: str) -> str:
            import re as _re
            return _re.sub(r'[\-\s_.]+', '_', str(s).strip().lower()).strip('_')

        cfg_out_section = cfg.get("Outputs") or cfg.get("outputs") or {}
        exp_stored = data.get("expected_output") or {}
        outputs_without_exp = {k for k in cfg_out_section if not exp_stored.get(k)}
        stale_keys = [k for k in list(exp_stored.keys()) if k not in cfg_output_keys]
        remap_changed = False
        for stale_key in stale_keys:
            if stale_key.startswith("__ctrl__"):
                continue  # ctrl file entries are never remapped to output keys
            rows = exp_stored.get(stale_key)
            if not rows or not isinstance(rows, list) or len(rows) == 0:
                continue
            cols = list(rows[0].keys()) if isinstance(rows[0], dict) else []
            if len(cols) <= 1:
                continue  # still garbage — skip
            stale_norm = {_norm_col_py(c) for c in cols}
            best_out_key = None
            best_score = 0.0
            for out_key in outputs_without_exp:
                out_fields = (cfg_out_section.get(out_key) or {}).get("fields") or []
                out_norm = {_norm_col_py(f.get("name", "")) for f in out_fields if f.get("name")}
                if not out_norm:
                    continue
                overlap = len(stale_norm & out_norm)
                score = overlap / max(len(stale_norm), len(out_norm))
                if score > best_score:
                    best_score = score
                    best_out_key = out_key
            if best_out_key and best_score >= 0.5:
                exp_stored[best_out_key] = exp_stored.pop(stale_key)
                outputs_without_exp.discard(best_out_key)
                remap_changed = True
        if remap_changed:
            data["expected_output"] = exp_stored

        return jsonify({
            "input_data": data.get("input_data") or {},
            "expected_output": data.get("expected_output") or {},
            "file_meta": data.get("file_meta") or {},
            "last_run_files": data.get("last_run_files") or {},
            "test_ctrl_files": data.get("test_ctrl_files") or {},
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>", methods=["PUT"])
def save_config(filename):
    """Save config JSON."""
    try:
        path = _config_path(filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = request.get_json(force=True)
        with open(path, "w", encoding="utf-8") as f:
            _safe_json_dump(data, f, indent=2)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>", methods=["DELETE"])
def delete_config(filename):
    """Delete a config JSON file and its associated test-data directory."""
    try:
        path = _config_path(filename)
        if not path.exists():
            return jsonify({"error": "Not found"}), 404
        if not path.is_file():
            return jsonify({"error": "Not a file"}), 400
        path.unlink()
        # Also remove the companion test-data directory (if any)
        try:
            td_dir = _test_data_dir(filename)
            if td_dir.exists():
                shutil.rmtree(td_dir, ignore_errors=True)
                app.logger.info("Removed test-data dir for %s: %s", filename, td_dir)
        except Exception as td_err:
            app.logger.warning("Could not remove test-data dir for %s: %s", filename, td_err)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/rename", methods=["POST"])
def rename_config(filename):
    """Rename a config JSON file. Body: { \"name\": \"new_name.json\" }."""
    try:
        path = _config_path(filename)
        if not path.exists():
            return jsonify({"error": "Not found"}), 404
        if not path.is_file():
            return jsonify({"error": "Not a file"}), 400
        data = request.get_json(silent=True) or {}
        new_name = (data.get("name") or data.get("new_name") or "").strip()
        if not new_name:
            return jsonify({"error": "Missing name"}), 400
        if not new_name.lower().endswith(".json"):
            new_name += ".json"
        new_path = _config_path(new_name)
        if new_path.exists():
            return jsonify({"error": "A file with that name already exists"}), 409
        path.rename(new_path)
        return jsonify({"ok": True, "path": new_name})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _search_in_obj(obj, query: str, path: str, results: list):
    """Recursively search for query in dict/list; append matches to results."""
    q = query.lower()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if q in str(k).lower():
                results.append({"path": p, "snippet": str(v)[:200], "value": v})
            _search_in_obj(v, query, p, results)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _search_in_obj(v, query, f"{path}[{i}]", results)
    else:
        if q in str(obj).lower():
            results.append({"path": path, "snippet": str(obj)[:200], "value": obj})


@app.route("/api/search")
def search():
    """Search in all JSON files under CONFIG_DIR. q= search term."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})

    results = []
    try:
        for entry in _find_json_files(_get_config_dir()):
            path = _config_path(entry["path"])
            if not path.exists():
                continue
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            matches = []
            _search_in_obj(data, q, "", matches)
            for m in matches:
                m["file"] = entry["path"]
                results.append(m)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"results": results[:100]})


def _safe_config_filename(name: str) -> str:
    """Return a safe config filename (e.g. imported_mainflow.json)."""
    base = re.sub(r"[^\w\-]", "_", name).strip("_") or "imported"
    if not base.lower().endswith(".json"):
        base += ".json"
    return base


def _test_data_dir(config_filename: str) -> Path:
    """Return persistent test-data directory for this config (inside app, keyed by config)."""
    base = _get_config_dir()
    test_data_root = base.parent / "test_data"
    # One dir per config: e.g. imported_mainflow.json -> test_data/imported_mainflow/
    safe_key = config_filename.replace(".json", "").replace("/", "__").strip() or "default"
    return test_data_root / safe_key


def _parse_ctrl_file_text(text: str, ctrl_file_fields: list, ctrl_include_header: bool = False) -> list:
    """
    Parse a fixed-width control file into column-keyed row dicts.

    Mirrors the logic in test_dataflow._parse_ctrl_output and
    transformations._create_ctrl_file so that uploaded expected CTL files
    are always parsed with the same positional layout as the generated ones.
    Fields are placed sequentially (cumulative positions) using their declared
    lengths (default 15 for numeric, 20 for string when length=0).

    When ctrl_include_header=True the first line (field-name header) is
    detected by comparing it against the expected header sentinel and skipped.

    Falls back to raw {"value": line} rows when ctrl_file_fields is empty.
    """
    _DEFAULT_NUM_LEN = 15
    _DEFAULT_STR_LEN = 20
    _NUMERIC_TYPES = {"LONG", "INT", "INTEGER", "BIGINT"}

    lines = [ln.rstrip("\r") for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    if not ctrl_file_fields:
        if ctrl_include_header and lines:
            lines = lines[1:]
        return [{"value": line} for line in lines]

    # Build (name, pos, length, is_numeric) slices — cumulative positions
    field_slices: list[tuple[str, int, int, bool]] = []
    pos = 0
    for f in ctrl_file_fields:
        name = (f.get("name") or "").strip()
        if not name:
            continue
        ftype = (f.get("type") or "STRING").upper()
        is_numeric = ftype in _NUMERIC_TYPES
        length = int(f.get("length") or 0)
        if not length:
            length = _DEFAULT_NUM_LEN if is_numeric else _DEFAULT_STR_LEN
        field_slices.append((name, pos, length, is_numeric))
        pos += length

    # Skip header line when ctrl_include_header=True
    if ctrl_include_header and field_slices:
        first_fname, first_start, first_len, _ = field_slices[0]
        header_sentinel = first_fname[:first_len].ljust(first_len)
        lines = [
            ln for ln in lines
            if ln[first_start: first_start + first_len] != header_sentinel
        ]

    rows = []
    for line in lines:
        row: dict = {}
        for fname, start, length, is_numeric in field_slices:
            raw = line[start: start + length].strip()
            # Normalize numeric: strip leading zeros (so "000000001" == "1")
            if is_numeric and raw:
                raw = raw.lstrip("0") or "0"
            row[fname] = raw
        rows.append(row)
    return rows


@app.route("/api/import-files", methods=["POST"])
def import_files():
    """Accept multiple input and output files; generate config JSON from them."""
    try:
        return _import_files_impl()
    except Exception as e:
        app.logger.exception("Import files: unhandled error")
        return jsonify({"error": f"Import failed: {e}"}), 500


def _import_files_impl():
    """Implementation of import-files; raises on error. Caller ensures JSON response."""
    
    config_name = (request.form.get("config_name") or "").strip() or "imported_from_files"
    save = True  # Always save the generated config
    
    # Get uploaded files
    input_files = request.files.getlist("input_files[]")
    output_files = request.files.getlist("output_files[]")
    
    if not input_files and not output_files:
        return jsonify({"error": "No files uploaded"}), 400
    
    # Load settings for path prefixes
    settings = _load_settings()
    base_s3 = (settings.get("input_output_path_prefix") or "").strip() or DEFAULT_SETTINGS["input_output_path_prefix"]
    input_prefix = (settings.get("input_dataset_prefix") or "").strip()
    output_prefix = (settings.get("output_dataset_prefix") or "").strip()
    
    # Generate configuration from files
    config = {
        "Inputs": {},
        "Outputs": {},
        "Transformations": {
            "description": "Data processing from uploaded files",
            "steps": []
        }
    }
    
    # Process input files
    for i, file in enumerate(input_files):
        if file and file.filename:
            file_name = Path(file.filename).stem
            input_key = f"INPUT_{i+1}_{file_name.upper()}"
            
            # Determine file format from extension
            file_ext = Path(file.filename).suffix.lower()
            if file_ext == '.csv':
                file_format = 'csv'
            elif file_ext == '.json':
                file_format = 'json'
            elif file_ext == '.parquet':
                file_format = 'parquet'
            else:
                file_format = 'fixed'  # default for text files
            
            # Create input path
            input_path = f"data/{input_prefix.lstrip('/')}/{file_name}"
            if not input_path.startswith('data/'):
                input_path = f"data/{input_path}"
            
            config["Inputs"][input_key] = {
                "name": input_key,
                "format": file_format,
                "path": input_path,
                "fields": []  # Will be populated if we can analyze the file
            }
    
    # Process output files
    for i, file in enumerate(output_files):
        if file and file.filename:
            file_name = Path(file.filename).stem
            output_key = f"OUTPUT_{i+1}_{file_name.upper()}"
            
            # Determine file format from extension
            file_ext = Path(file.filename).suffix.lower()
            if file_ext == '.csv':
                file_format = 'csv'
            elif file_ext == '.json':
                file_format = 'json'
            elif file_ext == '.parquet':
                file_format = 'parquet'
            else:
                file_format = 'parquet'  # default output format
            
            # Create output path
            output_path = f"data/{output_prefix.lstrip('/')}/{file_name}"
            if not output_path.startswith('data/'):
                output_path = f"data/{output_path}"
            
            config["Outputs"][output_key] = {
                "name": output_key,
                "format": file_format,
                "path": output_path,
                "write_mode": "overwrite"
            }
    
    # Create transformations if we have both inputs and outputs
    input_keys = list(config["Inputs"].keys())
    output_keys = list(config["Outputs"].keys())
    
    if input_keys and output_keys:
        # Create a simple passthrough transformation
        config["Transformations"]["steps"] = [{
            "id": "process_files",
            "description": "Process input files and generate outputs",
            "type": "select",
            "source_inputs": input_keys,
            "logic": {"columns": ["*"]},
            "output_alias": output_keys[0]  # Route to first output
        }]
        
        # If multiple outputs, add additional steps
        for i, output_key in enumerate(output_keys[1:], 1):
            config["Transformations"]["steps"].append({
                "id": f"copy_to_output_{i}",
                "description": f"Copy data to {output_key}",
                "type": "select",
                "source_inputs": [output_keys[0]],
                "logic": {"columns": ["*"]},
                "output_alias": output_key
            })
    elif input_keys:
        # Only inputs, create a simple validation step
        config["Transformations"]["steps"] = [{
            "id": "validate_inputs",
            "description": "Validate input files",
            "type": "filter",
            "source_inputs": input_keys,
            "logic": {"conditions": []},
            "output_alias": "validated_data"
        }]
    elif output_keys:
        # Only outputs, create a data generation step
        config["Transformations"]["steps"] = [{
            "id": "generate_outputs",
            "description": "Generate output data",
            "type": "select",
            "source_inputs": [],
            "logic": {"expressions": [{"target": "generated_field", "expression": "'sample_data'", "operation": "compute"}]},
            "output_alias": output_keys[0]
        }]
    
    # Save the configuration
    filename = _safe_config_filename(config_name)
    if save:
        try:
            path = _config_path(filename)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                _safe_json_dump(config, f, indent=2)
        except Exception as e:
            return jsonify({"error": f"Save failed: {e}", "config": config}), 500
    
    response = {
        "ok": True,
        "filename": filename,
        "config": config,
        "saved": save,
        "logs": [f"Generated config from {len(input_files)} input files and {len(output_files)} output files"]
    }
    
    return jsonify(response)


@app.route("/api/import-zip", methods=["POST"])
def import_zip():
    """Accept a ZIP file of mainframe artifacts; generate config (via LLM or rule-based parser per Settings) and optionally save."""
    try:
        return _import_zip_impl()
    except Exception as e:
        app.logger.exception("Import ZIP: unhandled error")
        return jsonify({"error": f"Import failed: {e}"}), 500


def _import_zip_impl():
    """Implementation of import-zip; raises on error. Caller ensures JSON response."""
    if not generate_config_from_zip:
        return jsonify({"error": "ZIP import not available (mainframe_parser not installed)"}), 503

    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "No file uploaded"}), 400

    if not file.filename.lower().endswith(".zip"):
        return jsonify({"error": "File must be a .zip archive"}), 400

    config_name = (request.form.get("config_name") or "").strip() or "imported_mainflow"
    save = request.form.get("save", "true").lower() in ("true", "1", "yes")
    settings = _load_settings()
    # Use LLM to generate config when "Use LLM for parsing" is enabled in Settings
    use_llm = settings.get("use_llm", False)
    if use_llm:
        app.logger.info("Import ZIP: Use LLM is ON; will attempt LLM config generation")
    base_s3 = (settings.get("input_output_path_prefix") or "").strip() or DEFAULT_SETTINGS["input_output_path_prefix"]
    input_prefix = (settings.get("input_dataset_prefix") or "").strip()
    output_prefix = (settings.get("output_dataset_prefix") or "").strip()
    llm_base_url = (settings.get("llm_base_url") or "").strip() or None
    llm_model = (settings.get("llm_model") or "").strip() or None
    llm_timeout = max(60, min(3600, int(settings.get("llm_timeout_seconds") or 600)))

    import_logs = []
    import_logs.append("Import ZIP: Use LLM is ON; will attempt LLM config generation." if use_llm else "Import ZIP: Use LLM is OFF; using rule-based parser.")

    try:
        result = generate_config_from_zip(
            file.stream,
            base_s3_path=request.form.get("base_s3_path") or base_s3,
            input_dataset_prefix=input_prefix or None,
            output_dataset_prefix=output_prefix or None,
            use_llm=use_llm,
            llm_base_url=llm_base_url,
            llm_model=llm_model,
            llm_timeout_seconds=llm_timeout,
            log_sink=import_logs,
        )
        config = result["config"]
        discovery = result.get("discovery", {})
        import_logs = result.get("logs", import_logs)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Import failed: {e}"}), 500

    filename = _safe_config_filename(config_name)
    if save:
        try:
            path = _config_path(filename)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                _safe_json_dump(config, f, indent=2)
        except Exception as e:
            return jsonify({"error": f"Save failed: {e}", "config": config}), 500

    # Persist input/expected_output under config-keyed dir so they survive refresh/restart
    if result.get("input_data") or result.get("expected_output"):
        try:
            td_dir = _test_data_dir(filename)
            td_dir.mkdir(parents=True, exist_ok=True)
            td_file = td_dir / "test_data.json"
            with open(td_file, "w", encoding="utf-8") as f:
                _safe_json_dump({
                    "input_data": result.get("input_data") or {},
                    "expected_output": result.get("expected_output") or {},
                }, f, indent=2)
        except Exception as e:
            app.logger.warning("Could not persist test data for %s: %s", filename, e)

    response = {
        "ok": True,
        "filename": filename,
        "config": config,
        "saved": save,
        "discovery": discovery,
        "logs": import_logs,
    }
    if result.get("input_data"):
        response["input_data"] = result["input_data"]
    if result.get("expected_output"):
        response["expected_output"] = result["expected_output"]
    if result.get("test_data_summary"):
        response["test_data_summary"] = result["test_data_summary"]
    return jsonify(response)


@app.route("/api/test/generate-sample", methods=["POST"])
def api_test_generate_sample():
    """Generate sample test data from config (copybook/schema)."""
    if not generate_sample_data:
        return jsonify({"error": "Test module not available"}), 503
    try:
        data = request.get_json(silent=True) or {}
        config = data.get("config")
        config_path = (data.get("config_path") or "").strip()
        if config_path and not config:
            path = _config_path(config_path)
            if path.exists():
                with open(path, "r", encoding="utf-8") as f:
                    config = json.load(f)
        if not config:
            return jsonify({"error": "Missing config or config_path"}), 400
        num_rows = int(data.get("num_rows", 5))
        sample = generate_sample_data(config, num_rows=min(num_rows, 20))
        return jsonify({"ok": True, "inputs": sample})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/test/run", methods=["POST"])
def api_test_run():
    """Run dataflow with sample data; return inputs, outputs, logs."""
    if not run_dataflow_test:
        return jsonify({"error": "Test module not available"}), 503
    try:
        data = request.get_json(silent=True) or {}
        config_path_rel = (data.get("config_path") or data.get("config_name") or "").strip()
        if not config_path_rel:
            return jsonify({"error": "Missing config_path"}), 400
        path = _config_path(config_path_rel)
        if not path.exists():
            return jsonify({"error": "Config not found"}), 404
        with open(path, "r", encoding="utf-8") as f:
            config = json.load(f)
        sample_data = data.get("sample_data")  # optional; will generate if missing
        result = run_dataflow_test(
            config=config,
            config_name=path.name,
            base_path=path.parent,
            sample_data=sample_data,
            num_sample_rows=int(data.get("num_rows", 5)),
        )
        return jsonify({"ok": result.get("error") is None, **result})
    except Exception as e:
        return jsonify({"error": str(e), "logs": str(e)}), 500


@app.route("/api/test/run-stream", methods=["POST"])
def api_test_run_stream():
    """Stream dataflow run: yields log lines in real time, then JSON result."""
    if not run_dataflow_test_stream:
        return jsonify({"error": "Test module not available"}), 503
    try:
        data = request.get_json(silent=True) or {}
        config_path_rel = (data.get("config_path") or data.get("config_name") or "").strip()
        if not config_path_rel:
            return jsonify({"error": "Missing config_path"}), 400
        path = _config_path(config_path_rel)
        if not path.exists():
            return jsonify({"error": "Config not found"}), 404
        with open(path, "r", encoding="utf-8") as f:
            config = json.load(f)
        sample_data = data.get("sample_data")
        num_rows = int(data.get("num_rows", 5))

        def gen():
            for chunk in run_dataflow_test_stream(
                config=config,
                config_name=path.name,
                base_path=path.parent,
                sample_data=sample_data,
                num_sample_rows=num_rows,
            ):
                yield chunk

        return Response(
            gen(),
            mimetype="text/plain",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/download")
def download_config(filename):
    """Serve config JSON as a downloadable file (Content-Disposition: attachment)."""
    try:
        path = _config_path(filename)
        if not path.exists():
            return jsonify({"error": "Not found"}), 404
        return send_file(
            path,
            as_attachment=True,
            download_name=path.name,
            mimetype="application/json",
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/parse-copybook", methods=["POST"])
def api_parse_copybook():
    """Parse an uploaded copybook (.cbl, .cpy) and return field definitions as JSON."""
    try:
        file = request.files.get("file")
        if not file or not file.filename:
            return jsonify({"error": "No file uploaded"}), 400
        content = file.read().decode("utf-8", errors="replace")
        from mainframe_parser.parsers.copybook_parser import CopybookParser
        parser = CopybookParser()
        fields = parser.parse_content(content)
        fields_json = [
            {
                "name": f.name,
                "type": f.type,
                "length": f.length,
                "precision": f.precision,
                "nullable": f.nullable if hasattr(f, "nullable") else True,
                "start": f.start if hasattr(f, "start") else None,
                "format": getattr(f, "format", None),
                "record_type": getattr(f, "record_type", "DATA"),
                "just_right": getattr(f, "just_right", False),
            }
            for f in fields
        ]
        return jsonify({"ok": True, "fields": fields_json})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/node-test-file", methods=["POST"])
def api_save_node_test_file(filename):
    """Save a test CSV/data file for a specific input/output node of a config."""
    try:
        import csv as csv_mod
        import io as io_mod
        node_name = (request.form.get("node_name") or "").strip()
        node_type = (request.form.get("node_type") or "input").strip().lower()
        file = request.files.get("file")
        if not node_name or not file or not file.filename:
            return jsonify({"error": "Missing node_name or file"}), 400
        td_dir = _test_data_dir(filename)
        td_dir.mkdir(parents=True, exist_ok=True)
        td_json = td_dir / "test_data.json"
        ext = Path(file.filename).suffix or ".csv"
        safe_node = node_name.replace("/", "_").replace("..", "_").replace(" ", "_")
        dest = td_dir / f"node_{safe_node}{ext}"
        # Delete previous test file for this node if it exists
        try:
            _prev_meta = json.loads(td_json.read_text()) if td_json.exists() else {}
        except Exception:
            _prev_meta = {}
        _old_fm = (_prev_meta.get("file_meta") or {}).get(node_name)
        if _old_fm and _old_fm.get("test_file"):
            _old_ext = Path(_old_fm["test_file"]).suffix or ".csv"
            _old_dest = td_dir / f"node_{safe_node}{_old_ext}"
            if _old_dest.exists() and _old_dest != dest:
                _old_dest.unlink(missing_ok=True)
        raw_bytes = file.read()
        dest.write_bytes(raw_bytes)
        # Determine which bucket to store rows in based on node_type
        data_key = "expected_output" if node_type == "output" else "input_data"
        # Try to parse CSV and store rows in test_data.json
        try:
            existing = json.loads(td_json.read_text()) if td_json.exists() else {}
        except Exception:
            existing = {}
        if "input_data" not in existing:
            existing["input_data"] = {}
        if "expected_output" not in existing:
            existing["expected_output"] = {}
        if "file_meta" not in existing:
            existing["file_meta"] = {}
        rows = []
        file_format = (request.form.get("format") or "").strip().upper()
        fields_json  = (request.form.get("fields") or "").strip()
        node_cfg: dict | None = None
        # Always load node_cfg from the saved config so header_count / trailer_count
        # are available for skipping, even when format+fields are sent by the client.
        try:
            cfg_path = _config_path(filename)
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            section = "Outputs" if node_type == "output" else "Inputs"
            node_cfg = (cfg.get(section) or cfg.get(section.lower()) or {}).get(node_name)
        except Exception:
            pass
        # Auto-detect format/fields from config if not provided in request
        if (not file_format or (file_format == "FIXED" and not fields_json)) and isinstance(node_cfg, dict):
            cfg_fmt = (node_cfg.get("format") or "").strip().upper()
            if cfg_fmt == "FIXED" and node_cfg.get("fields"):
                file_format = "FIXED"
                fields_json = json.dumps(node_cfg["fields"])
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
            # Control-file expected uploads: parse the raw fixed-width CTL file using
            # ctrl_file_fields from the matching validate step so that column names and
            # positions exactly match the generated ctrl output (also parsed the same way
            # by _parse_ctrl_output in test_dataflow.py).
            if node_name.startswith("__ctrl__"):
                _ctrl_step_id = node_name[len("__ctrl__"):]
                _ctrl_fields: list = []
                _ctrl_incl_hdr: bool = False
                try:
                    _cfg = json.loads(_config_path(filename).read_text(encoding="utf-8"))
                    for _st in ((_cfg.get("Transformations") or {}).get("steps") or []):
                        if _st.get("id") == _ctrl_step_id:
                            _lgc = _st.get("logic") or {}
                            _ctrl_fields = _lgc.get("ctrl_file_fields") or []
                            _ctrl_incl_hdr = bool(_lgc.get("ctrl_include_header", False))
                            break
                except Exception:
                    pass
                rows = _parse_ctrl_file_text(text, _ctrl_fields, _ctrl_incl_hdr)
                existing[data_key][node_name] = rows
            elif file_format == "FIXED" and fields_json:
                # Parse fixed-width using field positions from config
                fields_def = json.loads(fields_json)
                # ── Skip header / trailer rows ─────────────────────────────────
                hdr_skip = int((node_cfg or {}).get("header_count") or 0)
                trl_skip = int((node_cfg or {}).get("trailer_count") or 0)
                lines = [l.rstrip("\r") for l in text.splitlines() if l.rstrip("\r")]
                lines = lines[hdr_skip:]
                if trl_skip > 0 and trl_skip <= len(lines):
                    lines = lines[:-trl_skip]
                if node_type == "output":
                    # ── Output FIXED files: use CUMULATIVE positions ───────────
                    # The dataflow engine (_write_fixed_width) concatenates DATA
                    # fields in declaration order, each padded to its length.
                    # The 'start' values in the schema describe the SOURCE layout
                    # (input copybook positions) and do NOT match the output layout.
                    # Using cumulative positions here exactly mirrors what the
                    # engine wrote so that expected vs generated comparison is fair.
                    data_fields = [
                        f for f in fields_def
                        if (f.get("record_type") or "DATA").upper() not in ("HEADER", "TRAILER")
                    ]
                    slices: list[tuple[str, int, int]] = []
                    pos = 0
                    for f in data_fields:
                        fname = f.get("name") or ""
                        length = int(f.get("length") or 1)
                        slices.append((fname, pos, length))
                        pos += length
                    for line in lines:
                        if not line:
                            continue
                        row = {}
                        for fname, fstart, length in slices:
                            row[fname] = line[fstart : fstart + length].strip()
                        rows.append(row)
                else:
                    # ── Input FIXED files: use schema 'start' positions ────────
                    # Normalize absolute start positions for multi-record copybooks:
                    # if min(start) - 1 >= line length the copybook assigned absolute
                    # positions across all record groups; subtract the offset so
                    # positions become record-relative (1-based).
                    start_adj = 0
                    if lines and fields_def:
                        min_start = min(
                            (int(f.get("start") or 1) for f in fields_def if f.get("start")),
                            default=1,
                        )
                        if min_start > 1 and (min_start - 1) >= len(lines[0]):
                            start_adj = min_start - 1
                    for line in lines:
                        if not line:
                            continue
                        row = {}
                        for f in fields_def:
                            fname = f.get("name") or ""
                            start = max(0, int(f.get("start") or 1) - 1 - start_adj)
                            length = int(f.get("length") or 1)
                            row[fname] = line[start : start + length].strip()
                        rows.append(row)
                existing[data_key][node_name] = rows
            else:
                # Generic CSV / delimited file — strip surrounding whitespace from
                # all values so that "  value  " matches the engine's stripped output.
                reader = csv_mod.DictReader(io_mod.StringIO(text))
                rows = [
                    {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
                    for row in reader
                ]
                existing[data_key][node_name] = rows
        except Exception:
            pass  # store file but skip row parsing
        # Persist file metadata
        existing["file_meta"][node_name] = {
            "test_file": file.filename,
            "rows": len(rows),
            "type": node_type,
        }
        td_json.write_text(json.dumps(existing, indent=2))
        return jsonify({"ok": True, "node": node_name, "rows": len(rows), "file": file.filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/last-run-file", methods=["POST"])
def api_save_last_run_file(filename):
    """Save an uploaded last-run or test-ctrl file for a validate step (test runs)."""
    try:
        step_id = (request.form.get("step_id") or "").strip()
        file_type = (request.form.get("file_type") or "last_run").strip()
        file = request.files.get("file")
        if not step_id or not file or not file.filename:
            return jsonify({"error": "Missing step_id or file"}), 400
        td_dir = _test_data_dir(filename)
        # Use separate subdirs: last_run/<step_id> vs test_ctrl/<step_id>
        sub_dir = "test_ctrl" if file_type == "test_ctrl" else "last_run"
        lr_dir = td_dir / sub_dir / step_id
        lr_dir.mkdir(parents=True, exist_ok=True)
        # Clean up old files first (only keep one file per step)
        for old_file in lr_dir.iterdir():
            if old_file.is_file():
                old_file.unlink()
        # Save with the original filename
        dest = lr_dir / Path(file.filename).name
        raw_bytes = file.read()
        dest.write_bytes(raw_bytes)
        # Persist metadata to test_data.json under separate keys
        td_json = td_dir / "test_data.json"
        try:
            existing = json.loads(td_json.read_text()) if td_json.exists() else {}
        except Exception:
            existing = {}
        meta_key = "test_ctrl_files" if file_type == "test_ctrl" else "last_run_files"
        if meta_key not in existing:
            existing[meta_key] = {}
        existing[meta_key][step_id] = {
            "file": file.filename,
            "path": str(dest),
        }
        # When a test ctrl file is uploaded from the validate-node props panel,
        # also sync it into expected_output so the testing-window reconciliation
        # can compare generated vs expected control file content.
        # Parse the fixed-width CTL file using ctrl_file_fields from the matching
        # validate step so column names match the generated ctrl output exactly.
        if file_type == "test_ctrl":
            try:
                text = raw_bytes.decode("utf-8", errors="replace")
                _lr_ctrl_fields: list = []
                _lr_ctrl_incl_hdr: bool = False
                try:
                    _lr_cfg = json.loads(_config_path(filename).read_text(encoding="utf-8"))
                    for _lr_st in ((_lr_cfg.get("Transformations") or {}).get("steps") or []):
                        if _lr_st.get("id") == step_id:
                            _lr_lgc = _lr_st.get("logic") or {}
                            _lr_ctrl_fields = _lr_lgc.get("ctrl_file_fields") or []
                            _lr_ctrl_incl_hdr = bool(_lr_lgc.get("ctrl_include_header", False))
                            break
                except Exception:
                    pass
                ctrl_rows = _parse_ctrl_file_text(text, _lr_ctrl_fields, _lr_ctrl_incl_hdr)
                if "expected_output" not in existing:
                    existing["expected_output"] = {}
                existing["expected_output"]["__ctrl__" + step_id] = ctrl_rows
            except Exception:
                pass
        td_json.write_text(json.dumps(existing, indent=2))
        return jsonify({"ok": True, "step_id": step_id, "file": file.filename, "file_type": file_type})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/rename-node-test-data", methods=["POST"])
def api_rename_node_test_data(filename):
    """Rename test data files and metadata keys when a node is renamed."""
    try:
        data = request.get_json(force=True) or {}
        old_name = (data.get("old_name") or "").strip()
        new_name = (data.get("new_name") or "").strip()
        node_type = (data.get("node_type") or "input").strip().lower()
        if not old_name or not new_name or old_name == new_name:
            return jsonify({"ok": True, "skipped": True})
        td_dir = _test_data_dir(filename)
        safe_old = old_name.replace("/", "_").replace("..", "_").replace(" ", "_")
        safe_new = new_name.replace("/", "_").replace("..", "_").replace(" ", "_")
        # Rename physical files on disk (node_*, copybook_*)
        if td_dir.exists():
            for f in td_dir.iterdir():
                if f.is_file() and (f.name.startswith(f"node_{safe_old}") or f.name.startswith(f"copybook_{safe_old}")):
                    new_fname = f.name.replace(safe_old, safe_new, 1)
                    f.rename(td_dir / new_fname)
        # Update test_data.json keys
        td_json = td_dir / "test_data.json"
        if td_json.exists():
            try:
                td = json.loads(td_json.read_text())
            except Exception:
                td = {}
            data_key = "expected_output" if node_type == "output" else "input_data"
            for section in [data_key, "file_meta"]:
                if section in td and old_name in td[section]:
                    td[section][new_name] = td[section].pop(old_name)
            td_json.write_text(json.dumps(td, indent=2))
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/<path:filename>/node-copybook", methods=["POST"])
def api_save_node_copybook(filename):
    """Parse and save a copybook for a specific node, update file_meta."""
    try:
        node_name = (request.form.get("node_name") or "").strip()
        node_type = (request.form.get("node_type") or "input").strip().lower()
        file = request.files.get("file")
        if not node_name or not file or not file.filename:
            return jsonify({"error": "Missing node_name or file"}), 400
        td_dir = _test_data_dir(filename)
        td_dir.mkdir(parents=True, exist_ok=True)
        safe_node = node_name.replace("/", "_").replace("..", "_").replace(" ", "_")
        dest = td_dir / f"copybook_{safe_node}{Path(file.filename).suffix or '.cbl'}"
        raw_bytes = file.read()
        dest.write_bytes(raw_bytes)
        # Parse copybook — same logic as /api/parse-copybook
        from mainframe_parser.parsers.copybook_parser import CopybookParser
        parser = CopybookParser()
        content = raw_bytes.decode("utf-8", errors="replace")
        fields = parser.parse_content(content)
        fields_json = [
            {
                "name": f.name,
                "type": f.type,
                "length": f.length,
                "precision": f.precision,
                "nullable": f.nullable if hasattr(f, "nullable") else True,
                "start": f.start if hasattr(f, "start") else None,
                "format": getattr(f, "format", None),
                "record_type": getattr(f, "record_type", "DATA"),
                "just_right": getattr(f, "just_right", False),
            }
            for f in fields
        ]
        # Update test_data.json file_meta
        td_json = td_dir / "test_data.json"
        try:
            existing = json.loads(td_json.read_text()) if td_json.exists() else {}
        except Exception:
            existing = {}
        if "input_data" not in existing:
            existing["input_data"] = {}
        if "expected_output" not in existing:
            existing["expected_output"] = {}
        if "file_meta" not in existing:
            existing["file_meta"] = {}
        meta = existing["file_meta"].get(node_name, {})
        meta["copybook_file"] = file.filename
        meta["fields"] = len(fields_json)
        meta["type"] = node_type
        existing["file_meta"][node_name] = meta
        td_json.write_text(json.dumps(existing, indent=2))
        return jsonify({"ok": True, "node": node_name, "fields": fields_json, "file": file.filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    _get_config_dir().mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, port=port,host='0.0.0.0')
