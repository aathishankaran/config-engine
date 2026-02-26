"""
Config Engine - Flask backend.
Serves config JSON list, get/save, search, import from ZIP, and download JSON.
"""

import json
import os
import re
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
    return send_from_directory(app.static_folder or ".", "dataflow-studio.html")


@app.route("/builder")
def builder():
    """Dataflow Builder - drag-and-drop page to create dataflow JSON."""
    return send_from_directory(app.static_folder or ".", "dataflow-builder.html")


@app.route("/studio")
def studio():
    """Dataflow Studio - advanced draw.io-style editor to build dataflow JSON from scratch."""
    return send_from_directory(app.static_folder or ".", "dataflow-studio.html")


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
        _config_path(filename)  # validate path
        td_dir = _test_data_dir(filename)
        td_file = td_dir / "test_data.json"
        if not td_file.exists():
            return jsonify({"input_data": {}, "expected_output": {}})
        with open(td_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify({
            "input_data": data.get("input_data") or {},
            "expected_output": data.get("expected_output") or {},
            "file_meta": data.get("file_meta") or {},
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
    """Delete a config JSON file."""
    try:
        path = _config_path(filename)
        if not path.exists():
            return jsonify({"error": "Not found"}), 404
        if not path.is_file():
            return jsonify({"error": "Not a file"}), 400
        path.unlink()
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
    test_data_root = base / "test_data"
    # One dir per config: e.g. imported_mainflow.json -> test_data/imported_mainflow/
    safe_key = config_filename.replace(".json", "").replace("/", "__").strip() or "default"
    return test_data_root / safe_key


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
        ext = Path(file.filename).suffix or ".csv"
        safe_node = node_name.replace("/", "_").replace("..", "_").replace(" ", "_")
        dest = td_dir / f"node_{safe_node}{ext}"
        raw_bytes = file.read()
        dest.write_bytes(raw_bytes)
        # Determine which bucket to store rows in based on node_type
        data_key = "expected_output" if node_type == "output" else "input_data"
        # Try to parse CSV and store rows in test_data.json
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
        rows = []
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
            reader = csv_mod.DictReader(io_mod.StringIO(text))
            rows = [dict(row) for row in reader]
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
    app.run(debug=True, port=5000)
