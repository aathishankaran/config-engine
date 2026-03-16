"""
Test dataflow: generate sample data and run dataflow-engine for the Test UI.

Uses the dataflow-engine (sibling project or DATAFLOW_ENGINE_DIR) via subprocess
so the parser-engine does not require PySpark at runtime.
"""

import csv
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def _dataflow_engine_dir() -> Path | None:
    """Return path to dataflow-engine project, or None if not found."""
    env_path = os.environ.get("DATAFLOW_ENGINE_DIR")
    if env_path:
        p = Path(env_path).resolve()
        if (p / "run_dataflow.py").exists():
            return p
    # Sibling: parser-engine/util -> parser-engine -> ai-generated -> dataflow-engine
    for candidate in [
        Path(__file__).resolve().parent.parent.parent / "dataflow-engine",
        Path(__file__).resolve().parent.parent / "dataflow-engine",
    ]:
        if (candidate / "run_dataflow.py").exists():
            return candidate
    return None


def _has_pyspark(python_exe: str) -> bool:
    """Return True if the given Python interpreter has pyspark importable."""
    try:
        result = subprocess.run(
            [python_exe, "-c", "import pyspark"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


def _get_spark_env() -> dict:
    """
    Build an environment dict for PySpark subprocesses.

    PySpark 3.5.x requires Java 8/11/17.  If the system default is newer
    (e.g. Java 25) Spark crashes with ``getSubject is not supported``.
    This helper detects a compatible JDK and sets JAVA_HOME accordingly.

    Resolution order:
      1. SPARK_JAVA_HOME env var (explicit override)
      2. Existing JAVA_HOME if version <= 17
      3. Well-known macOS JDK 17 path
      4. Well-known macOS JDK 11 path
      5. Fall through with current env (let the error surface naturally)
    """
    env = os.environ.copy()

    # 1. Explicit override
    spark_java = os.environ.get("SPARK_JAVA_HOME", "").strip()
    if spark_java and Path(spark_java).is_dir():
        env["JAVA_HOME"] = spark_java
        return env

    # 2. Check current JAVA_HOME version
    current_java = os.environ.get("JAVA_HOME", "").strip()
    if current_java:
        try:
            ver_out = subprocess.run(
                [str(Path(current_java) / "bin" / "java"), "-version"],
                capture_output=True, text=True, timeout=5,
            ).stderr
            # Parse version like "17.0.9" or "11.0.27"
            import re
            m = re.search(r'"(\d+)', ver_out)
            if m and int(m.group(1)) <= 17:
                return env  # current JAVA_HOME is fine
        except Exception:
            pass

    # 3-4. Well-known macOS paths for JDK 17 / 11
    for jdk in (
        "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home",
        "/Library/Java/JavaVirtualMachines/jdk-11.jdk/Contents/Home",
    ):
        if Path(jdk).is_dir():
            env["JAVA_HOME"] = jdk
            return env

    return env


def _find_python_with_pyspark(engine_dir: Path | None = None) -> str:
    """
    Return a Python executable that has PySpark installed.

    Resolution order:
      1. DATAFLOW_ENGINE_PYTHON env var (explicit override)
      2. venv inside the dataflow-engine directory (.venv/bin/python or venv/bin/python)
      3. sys.executable (current interpreter — fast path when already has pyspark)
      4. 'python3' / 'python' on PATH
    Falls back to sys.executable so the error surfaces at the subprocess level.
    """
    # 1. Explicit override
    env_py = os.environ.get("DATAFLOW_ENGINE_PYTHON", "").strip()
    if env_py and _has_pyspark(env_py):
        return env_py

    # 2. venv inside dataflow-engine project
    if engine_dir:
        for rel in (".venv/bin/python", "venv/bin/python",
                    ".venv/Scripts/python.exe", "venv/Scripts/python.exe"):
            candidate = engine_dir / rel
            if candidate.exists() and _has_pyspark(str(candidate)):
                return str(candidate)

    # 3. Current interpreter (fast path — works when running inside the right venv)
    if _has_pyspark(sys.executable):
        return sys.executable

    # 4. Generic python3 / python on PATH
    for name in ("python3", "python"):
        try:
            full = subprocess.run(
                ["which", name], capture_output=True, text=True, timeout=5
            ).stdout.strip()
            if full and _has_pyspark(full):
                return full
        except Exception:
            pass

    # Nothing found — return sys.executable so the error is clear
    return sys.executable


def _sample_value(field: dict, row_idx: int) -> str:
    """Generate a plausible sample value for a single field definition."""
    from datetime import date, timedelta

    ftype = (field.get("type") or "TEXT").upper()
    length = int(field.get("length") or 10)
    fmt = (field.get("format") or "").upper()
    fname = (field.get("name") or "").upper()

    # DATE fields — produce yyyyMMdd strings
    if ftype == "DATE" or fmt in ("DATE", "YYYYMMDD"):
        d = date.today() - timedelta(days=row_idx)
        return d.strftime("%Y%m%d")

    # TIMESTAMP fields
    if ftype == "TIMESTAMP":
        d = date.today() - timedelta(days=row_idx)
        return d.strftime("%Y%m%d%H%M%S")

    # Numeric / amount / count / rate fields
    if ftype in ("NUMBER", "NUMERIC", "DECIMAL", "INT", "INTEGER", "LONG", "BIGINT"):
        val = str((row_idx + 1) * 100)
        return val.zfill(length)

    # Heuristic: field name contains AMOUNT, COUNT, RATE, NUM, etc.
    if any(kw in fname for kw in ("AMOUNT", "COUNT", "RATE", "TOTAL", "HASH", "SEQ")):
        val = str((row_idx + 1) * 100)
        return val.zfill(length)

    # Heuristic: field name contains DATE
    if "DATE" in fname:
        d = date.today() - timedelta(days=row_idx)
        return d.strftime("%Y%m%d")

    # Record type indicator (single char)
    if "REC-TYPE" in fname or "REC_TYPE" in fname:
        return "D"

    # Status / flag fields (short)
    if length <= 2 and ("STATUS" in fname or "FLAG" in fname):
        return "A"

    # Default text value — pad to length
    val = f"SAMPLE{row_idx + 1:03d}"
    if length > 0:
        val = val[:length].ljust(length)
    return val


def generate_sample_data(config: dict, num_rows: int = 5) -> dict[str, list[dict]]:
    """
    Generate minimal sample input data from config schema (Inputs.fields).
    Returns dict mapping input name -> list of row dicts.

    Produces type-aware values (valid dates, padded numbers, etc.) so that
    validation steps don't abort on malformed sample data.
    """
    inputs = config.get("Inputs") or config.get("inputs") or {}
    out: dict[str, list[dict]] = {}
    for name, cfg in inputs.items():
        if not isinstance(cfg, dict):
            continue
        fields = cfg.get("fields") or []
        if not fields:
            cols = ["id"]
            rows = [{"id": i} for i in range(max(1, num_rows))]
        else:
            data_fields = [
                f for f in fields
                if isinstance(f, dict)
                and (f.get("record_type") or "DATA").upper() not in ("HEADER", "TRAILER")
            ]
            if not data_fields:
                data_fields = [f for f in fields if isinstance(f, dict)]
            cols = [f.get("name") or f"col_{i}" for i, f in enumerate(data_fields)]
            if not cols:
                cols = ["id"]
                rows = [{"id": i} for i in range(max(1, num_rows))]
            else:
                rows = []
                for i in range(max(1, num_rows)):
                    row = {}
                    for f in data_fields:
                        fname = f.get("name") or ""
                        row[fname] = _sample_value(f, i)
                    rows.append(row)
        out[name] = rows
    return out


def _copy_last_run_file(
    base_path: Path,
    config_name: str,
    step_id: str,
    lr_temp: Path,
    last_run_file_name: str,
) -> str:
    """
    If the user uploaded a last-run-date file for this validate step via the UI,
    copy it into *lr_temp* so the validate step can find it during a test run.

    The persistent test-data directory mirrors the layout created by
    ``api_save_last_run_file`` in app.py:
        <test_data_root>/<config_key>/last_run/<step_id>/<original_filename>

    Returns the actual filename used in the temp dir (may differ from
    *last_run_file_name* if a user-uploaded file had a different name).
    """
    try:
        import shutil as _shutil
        safe_key = config_name.replace(".json", "").replace("/", "__").strip() or "default"
        test_data_root = base_path.parent / "test_data"
        lr_src_dir = test_data_root / safe_key / "last_run" / step_id
        if not lr_src_dir.is_dir():
            return ""
        # Pick the first file found (there should only be one)
        src_files = [f for f in lr_src_dir.iterdir() if f.is_file()]
        if not src_files:
            return ""
        src_file = src_files[0]
        lr_temp.mkdir(parents=True, exist_ok=True)
        # Use the target name if given, otherwise keep the uploaded file's name
        target_name = last_run_file_name or src_file.name
        dest = lr_temp / target_name
        _shutil.copy2(src_file, dest)
        return target_name
    except Exception:
        return ""  # Non-fatal — the validate step will log the missing file


def _write_fixed_input(
    rows: list[dict], path: Path, cfg: dict,
    trailer_data: dict | None = None,
    header_data: dict | None = None,
) -> None:
    """
    Write sample rows as a fixed-width text file matching the input field schema.

    Field values are placed at their raw 1-based ``start`` positions — exactly
    as the dataflow-engine runner reads them with ``F.substring(col("value"), start, length)``.
    No position adjustment is applied: if the config has ``start=121`` the value
    lands at character position 121 of the output line, so the runner can read it
    correctly without any normalisation on its side.

    Line width is ``max(start + length - 1)`` across all fields (or ``record_length``
    when that is larger).

    ``trailer_data``: optional dict of field-name -> value overrides written into
    the trailer line(s).  Used in test mode to inject the correct record count so
    the record_count_check validation passes.
    """
    fields = cfg.get("fields") or []
    record_length = int(cfg.get("record_length") or 0)
    header_count = int(cfg.get("header_count") or 0)
    trailer_count = int(cfg.get("trailer_count") or 0)
    header_fields = cfg.get("header_fields") or []
    trailer_fields = cfg.get("trailer_fields") or []

    # Line width = max end position across all fields, or record_length if larger
    all_flds = fields + header_fields + trailer_fields
    if all_flds:
        max_end = max(
            (int(f.get("start") or 1) + int(f.get("length") or 1) - 1
             for f in all_flds if f.get("start")),
            default=record_length or 80,
        )
        line_width = max(max_end, record_length)
    else:
        line_width = record_length or 80

    def _make_line(row: dict, flds: list) -> str:
        line = [" "] * line_width
        for f in flds:
            fname = f.get("name") or ""
            # start is 1-based in the config (matching Spark's F.substring convention)
            start = max(0, int(f.get("start") or 1) - 1)  # convert to 0-based
            length = int(f.get("length") or 1)
            val = str(row.get(fname, "") or "").ljust(length)[:length]
            end = min(start + length, line_width)
            line[start:end] = list(val[:end - start])
        return "".join(line)

    lines: list[str] = []
    # Build header row values: prefer real values from uploaded .DAT file,
    # fall back to generated sample values so the runner extracts meaningful metadata
    # (e.g. INP-HDR-FILE-DATE → "20260305") for ctrl file expression resolution.
    _hdr_row: dict = dict(header_data) if header_data else {}
    if header_fields:
        for _hf in header_fields:
            _hf_name = _hf.get("name") or ""
            if _hf_name and _hf_name not in _hdr_row:
                _hdr_row[_hf_name] = _sample_value(_hf, 0)
    for _ in range(header_count):
        lines.append(_make_line(_hdr_row, header_fields) if header_fields else " " * line_width)
    for row in rows:
        lines.append(_make_line(row, fields))
    # Trailer: merge injected data (e.g. record count) with empty defaults
    _trl_row = dict(trailer_data) if trailer_data else {}
    for _ in range(trailer_count):
        lines.append(_make_line(_trl_row, trailer_fields) if trailer_fields else " " * line_width)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _write_input_file(
    name: str, rows: list[dict], inp_cfg: dict, input_dir: Path,
    trailer_data: dict | None = None,
    header_data: dict | None = None,
) -> str:
    """
    Write test input rows in the format specified by inp_cfg["format"].
    Returns the relative path string (e.g. "input/NAME.csv" or "input/NAME.dat").
    ``trailer_data`` is forwarded to ``_write_fixed_input`` for FIXED format only.
    """
    fmt = (inp_cfg.get("format") or "csv").strip().upper()
    if fmt == "FIXED":
        file_name = f"{name}.dat"
        _write_fixed_input(rows, input_dir / file_name, inp_cfg, trailer_data=trailer_data, header_data=header_data)
        return f"input/{file_name}"
    elif fmt == "PARQUET":
        try:
            import pandas as pd
            dir_path = input_dir / name
            dir_path.mkdir(exist_ok=True)
            pd.DataFrame(rows).to_parquet(str(dir_path / "part-00000.parquet"), index=False)
        except Exception:
            pass
        return f"input/{name}"
    else:
        # CSV / DELIMITED / unknown — write as CSV with header
        file_name = f"{name}.csv"
        dest = input_dir / file_name
        if rows:
            with open(dest, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
        else:
            dest.touch()
        return f"input/{file_name}"


def _prepare_run(
    config: dict,
    config_name: str,
    base_path: Path,
    sample_data: dict | None,
    num_sample_rows: int,
) -> tuple[Path, Path, Path]:
    """
    Write config and sample data to a temp dir. Returns (temp_dir, config_path, base_path).

    Inputs are written in the format declared in the config (FIXED → fixed-width
    text, CSV/DELIMITED → CSV, PARQUET → parquet directory).  Outputs keep their
    configured format and target_file_name — only the path is redirected to the
    temp directory.  This mirrors exactly what a production run would do, so the
    downloaded config JSON can be run unmodified in the dataflow-engine project.
    """
    temp_dir = Path(tempfile.mkdtemp(prefix="parser_test_"))
    input_dir = temp_dir / "input"
    output_dir = temp_dir / "output"
    input_dir.mkdir()
    output_dir.mkdir()

    cfg = json.loads(json.dumps(config))
    inputs = cfg.get("Inputs") or cfg.get("inputs") or {}
    outputs = cfg.get("Outputs") or cfg.get("outputs") or {}

    data_by_name = sample_data if sample_data else generate_sample_data(cfg, num_rows=num_sample_rows)

    # ── Pre-scan validate steps for record_count_check ───────────────────────
    # When record_count_check is enabled, the trailer field must contain the
    # INCLUSIVE total record count (header rows + data rows + trailer rows),
    # because that is what production mainframe files carry and what the
    # engine subtracts header_count/trailer_count from before comparing.
    # Build a mapping of input_name -> {field_name: inclusive_count} so the
    # correct value is written into the trailer line of every FIXED test file.
    _trailer_inject: dict[str, dict] = {}
    trans_steps = (cfg.get("Transformations") or cfg.get("transformations") or {}).get("steps") or []
    _all_inputs_cfg = cfg.get("Inputs") or cfg.get("inputs") or {}
    for _vstep in trans_steps:
        if not isinstance(_vstep, dict) or _vstep.get("type") != "validate":
            continue
        _vlogic = _vstep.get("logic") or {}
        if not _vlogic.get("record_count_check"):
            continue
        _rc_field = (_vlogic.get("record_count_trailer_field") or "").strip()
        if not _rc_field:
            continue
        for _src in (_vstep.get("source_inputs") or []):
            _row_count = len(data_by_name.get(_src) or [])
            # Look up the input config for this source to get header/trailer counts.
            _inp_cfg = _all_inputs_cfg.get(_src) or {}
            if not _inp_cfg:
                # Case-insensitive fallback
                for _k, _v in _all_inputs_cfg.items():
                    if _k.upper() == _src.upper():
                        _inp_cfg = _v
                        break
            _hdr_cnt = int(_inp_cfg.get("header_count") or 0)
            _trl_cnt = int(_inp_cfg.get("trailer_count") or 0)
            # Trailer field holds the inclusive total: header + data + trailer.
            # The engine subtracts header_count + trailer_count before comparing
            # to the actual DataFrame row count, so we mirror that here.
            _total_count = _row_count + _hdr_cnt + _trl_cnt
            if _src not in _trailer_inject:
                _trailer_inject[_src] = {}
            # Store under all hyphen/underscore variants so the runner can
            # always find it regardless of name normalisation.
            _trailer_inject[_src][_rc_field] = str(_total_count)
            _trailer_inject[_src][_rc_field.replace("-", "_")] = str(_total_count)
            _trailer_inject[_src][_rc_field.replace("_", "-")] = str(_total_count)
    # ── End pre-scan ─────────────────────────────────────────────────────────

    # ── Extract header field values from original raw .DAT files on disk ──────
    # When ctrl file expressions reference header fields (e.g. first(INP-HDR-FILE-DATE)),
    # the runner needs real header values. Read them from the raw upload files.
    _header_inject: dict[str, dict] = {}
    _test_data_dir = base_path.parent / "test_data" / config_name.replace(".json", "")
    for name, inp_cfg_td in (cfg.get("Inputs") or cfg.get("inputs") or {}).items():
        if not isinstance(inp_cfg_td, dict):
            continue
        hdr_fields = inp_cfg_td.get("header_fields") or []
        hdr_count  = int(inp_cfg_td.get("header_count") or 0)
        if not hdr_fields or hdr_count <= 0:
            continue
        # Try to read header from the original raw file on disk
        safe_name = name.replace("/", "_").replace("..", "_").replace(" ", "_")
        for ext in (".DAT", ".dat", ".txt", ""):
            raw_file = _test_data_dir / f"node_{safe_name}{ext}"
            if raw_file.exists():
                try:
                    raw_lines = raw_file.read_text(encoding="utf-8", errors="replace").splitlines()
                    if raw_lines:
                        hdr_row: dict = {}
                        for hf in hdr_fields:
                            hf_name = hf.get("name") or ""
                            start = max(0, int(hf.get("start") or 1) - 1)
                            length = int(hf.get("length") or 1)
                            hdr_row[hf_name] = raw_lines[0][start:start + length].strip() if len(raw_lines[0]) >= start + length else ""
                        _header_inject[name] = hdr_row
                except Exception:
                    pass
                break

    for name, rows in data_by_name.items():
        inp_cfg = inputs.get(name)
        if not isinstance(inp_cfg, dict):
            continue
        rel_path = _write_input_file(name, rows, inp_cfg, input_dir,
                                     trailer_data=_trailer_inject.get(name),
                                     header_data=_header_inject.get(name))
        # Use the legacy "path" key — get_input_path() falls through to this when
        # source_path / source_file_name / dataset_name are all empty.
        inp_cfg["path"] = rel_path
        inp_cfg["source_path"] = ""
        inp_cfg["source_file_name"] = ""
        inp_cfg["dataset_name"] = ""
        # Keep format, delimiter_char, fields, record_length etc. unchanged

    for name in outputs:
        out_cfg = outputs.get(name)
        if isinstance(out_cfg, dict):
            # Redirect path to temp dir; everything else (format, target_file_name,
            # delimiter_char, record_length, fields…) stays exactly as configured.
            out_cfg["path"] = f"output/{name}"
            out_cfg["source_path"] = ""
            out_cfg["source_file_name"] = ""
            out_cfg["dataset_name"] = ""

    # ── Redirect validate-step side-effect paths to the temp dir ───────────────
    # Without this, validated_path / error_path / ctrl_output_path point at the
    # real production S3/local directories and the test will read/write actual data.
    validate_dir = temp_dir / "validated"
    error_dir    = temp_dir / "errors"
    ctrl_dir     = temp_dir / "ctrl"
    validate_dir.mkdir(exist_ok=True)
    error_dir.mkdir(exist_ok=True)
    ctrl_dir.mkdir(exist_ok=True)

    trans = cfg.get("Transformations") or cfg.get("transformations") or {}
    for step in trans.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if step.get("type") != "validate":
            continue
        logic = step.get("logic")
        if not isinstance(logic, dict):
            continue
        step_id = step.get("id") or "validate"
        # Always redirect — use sub-directories named after the step so multiple
        # validate steps don't overwrite each other.
        logic["validated_path"] = str(validate_dir / step_id)
        logic["error_path"]     = str(error_dir    / step_id)
        # Clear v2 schema fields so get_validate_paths() falls through to legacy
        logic["dataset_name"] = ""
        logic["error_dataset_name"] = ""
        if logic.get("ctrl_file_create"):
            logic["ctrl_output_path"] = str(ctrl_dir / step_id)
        # Clear frequency so the engine does NOT apply DAILY/date-based partitioning
        # to ctrl_output_path during test runs.  Without this, transformations.py calls
        # _build_partitioned_path(ctrl_path, "", "DAILY", "") and writes the ctrl file
        # to  ctrl/<step_id>/DAILY/<YYYYMMDD>/  instead of directly to ctrl/<step_id>/,
        # making _read_ctrl_outputs unable to find it with a simple directory scan.
        # Clearing frequency here is test-only isolation — it does NOT affect any data
        # transformation logic (the validate step's data processing is unchanged).
        logic["frequency"] = ""
        # Clear any last-run-file paths that may reference production storage;
        # redirect to temp dir so the test environment is fully isolated.
        lr_temp = temp_dir / "last_run"
        logic["last_run_file_path"] = str(lr_temp)
        # Disable frequency/date partitioning for test runs so the validate step
        # looks for the file at the flat lr_temp path (e.g. temp/last_run/<file>)
        # instead of a date-partitioned subdirectory (temp/last_run/DAILY/<date>/<file>)
        # that would never exist in the temp dir.
        logic["last_run_frequency"] = ""
        logic["partition_column"] = ""
        # Also clear the previous_day_* keys so the production S3 path and
        # frequency cannot leak back into the anticipated-path calculation and
        # cause Spark to attempt a remote S3/HDFS read during a local test run.
        # With previous_day_file_path cleared, the condition
        #   `if last_run_check and _prev_day_path:` (transformations.py)
        # is False and the entire previous-day header-date check is bypassed,
        # which is correct behaviour for a local test run.
        logic["previous_day_file_path"] = ""
        logic["previous_day_file_name"] = ""
        logic["previous_day_frequency"] = ""
        # Auto-derive last_run_file_name from the source input's dataset_name
        # when previous_day_check is enabled (same logic the engine uses at
        # runtime, but we need it here for the test copy step).
        lr_file_name = logic.get("last_run_file_name") or ""
        if (logic.get("last_run_check") or logic.get("previous_day_check")) and not lr_file_name:
            # Find the source input config to derive the file name
            src_inputs = step.get("source_inputs") or []
            inputs_cfg = cfg.get("Inputs") or cfg.get("inputs") or {}
            for src_name in src_inputs:
                src_cfg = inputs_cfg.get(src_name, {})
                if not src_cfg:
                    # Case-insensitive lookup
                    for k, v in inputs_cfg.items():
                        if k.upper() == src_name.upper():
                            src_cfg = v
                            break
                if src_cfg:
                    lr_file_name = src_cfg.get("dataset_name") or src_cfg.get("source_file_name") or ""
                    break
        if logic.get("last_run_check") or logic.get("previous_day_check"):
            # Try to copy user-uploaded file; returns actual filename used
            actual_name = _copy_last_run_file(base_path, config_name, step_id, lr_temp, lr_file_name)
            # Use the actual copied filename if copy succeeded
            if actual_name:
                lr_file_name = actual_name
            # If still no name, use a default
            if not lr_file_name:
                lr_file_name = "last_run_placeholder.dat"
            logic["last_run_file_name"] = lr_file_name
            # If no user-uploaded file was found, create a small placeholder so the
            # last_run_check passes in test mode (the file simply needs to exist).
            lr_dest = lr_temp / lr_file_name
            if not lr_dest.exists():
                lr_temp.mkdir(parents=True, exist_ok=True)
                lr_dest.write_text("# placeholder for test run\n")
    # ── End test-mode path isolation ───────────────────────────────────────────

    config_path = temp_dir / "config.json"
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return temp_dir, config_path, temp_dir


def _parse_fixed_output(text: str, fields: list, header_count: int, trailer_count: int) -> list[dict]:
    """
    Parse fixed-width output text into a list of row dicts, skipping header/trailer
    lines and using only DATA fields (record_type != HEADER/TRAILER).

    The dataflow-engine runner._write_fixed_width writes output by CONCATENATING
    fields in declaration order, each padded to its ``length``.  The ``start``
    positions in the config describe the source layout (not the output layout),
    so we ignore them and instead compute positions as cumulative field lengths —
    exactly matching the concatenation order the runner uses.
    """
    data_fields = [
        f for f in fields
        if (f.get("record_type") or "DATA").upper() not in ("HEADER", "TRAILER")
    ]
    lines = [ln.rstrip("\r") for ln in text.splitlines() if ln.rstrip("\r")]
    if header_count:
        lines = lines[header_count:]
    if trailer_count and trailer_count <= len(lines):
        lines = lines[:-trailer_count]
    if not lines or not data_fields:
        return []

    # Pre-compute (pos, length) for each field using cumulative lengths
    field_slices: list[tuple[str, int, int]] = []
    pos = 0
    for f in data_fields:
        fname = f.get("name") or ""
        length = int(f.get("length") or 1)
        field_slices.append((fname, pos, length))
        pos += length

    rows = []
    for line in lines:
        row: dict = {}
        for fname, start, length in field_slices:
            row[fname] = line[start: start + length].strip()
        rows.append(row)
    return rows


def _read_outputs(temp_dir: Path, config: dict) -> dict[str, list[dict]]:
    """
    Read actual output files from temp_dir/output/ in each output's configured format.

    The test module uses the SAME file format as declared in the dataflow config
    (FIXED → fixed-width text, CSV/DELIMITED → CSV, PARQUET → parquet parts).
    Only the file path differs from a production run; all format/schema handling
    is identical to what the dataflow-engine would do.
    """
    output_dir = temp_dir / "output"
    outputs_cfg = config.get("Outputs") or config.get("outputs") or {}
    result: dict[str, list[dict]] = {}

    for name, out_cfg in outputs_cfg.items():
        if not isinstance(out_cfg, dict):
            result[name] = []
            continue

        fmt = (out_cfg.get("format") or "parquet").strip().upper()
        out_dir = output_dir / name
        hdr_skip = int(out_cfg.get("header_count") or 0)
        trl_skip = int(out_cfg.get("trailer_count") or 0)
        rows: list[dict] = []

        if fmt == "FIXED":
            # Find the output file: named file first, then spark text part files
            target_name = (out_cfg.get("target_file_name") or "").strip()
            text = ""
            if target_name and out_dir.is_dir() and (out_dir / target_name).exists():
                text = (out_dir / target_name).read_text(encoding="utf-8", errors="replace")
            elif out_dir.is_dir():
                # Fallback: spark part files (when target_file_name was not set)
                part_files = sorted(
                    f for f in out_dir.rglob("part-*")
                    if f.is_file() and not f.name.endswith(".crc")
                )
                if part_files:
                    text = "\n".join(
                        f.read_text(encoding="utf-8", errors="replace") for f in part_files
                    )
            if text:
                rows = _parse_fixed_output(
                    text, out_cfg.get("fields") or [], hdr_skip, trl_skip
                )

        elif fmt in ("CSV", "DELIMITED"):
            import glob as _glob
            delimiter = (out_cfg.get("delimiter_char") or out_cfg.get("delimiter") or ",")
            # Look for a single named file, then spark CSV part files
            target_name = (out_cfg.get("target_file_name") or "").strip()
            csv_text = ""
            if target_name and out_dir.is_dir() and (out_dir / target_name).exists():
                csv_text = (out_dir / target_name).read_text(encoding="utf-8", errors="replace")
            elif out_dir.is_dir():
                part_files = sorted(set(
                    _glob.glob(str(out_dir / "part-*.csv"))
                    + _glob.glob(str(out_dir / "**" / "part-*.csv"), recursive=True)
                ))
                if part_files:
                    csv_text = "\n".join(
                        Path(f).read_text(encoding="utf-8", errors="replace") for f in part_files
                    )
            if csv_text:
                import io
                reader = csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)
                rows = list(reader)
                # Skip header/trailer text rows (delimiter-separated blank rows)
                if hdr_skip:
                    rows = rows[hdr_skip:]
                if trl_skip and trl_skip <= len(rows):
                    rows = rows[:-trl_skip]

        else:  # PARQUET (default)
            import glob as _glob
            if out_dir.exists() and out_dir.is_dir():
                try:
                    import pandas as pd
                    part_files = sorted(set(
                        _glob.glob(str(out_dir / "part-*.parquet"))
                        + _glob.glob(str(out_dir / "**" / "part-*.parquet"), recursive=True)
                    ))
                    if part_files:
                        df = pd.concat(
                            [pd.read_parquet(f) for f in part_files], ignore_index=True
                        )
                    else:
                        df = pd.read_parquet(out_dir)
                    rows = df.to_dict(orient="records")
                except Exception:
                    rows = []

        result[name] = rows
    return result


def _parse_ctrl_output(text: str, ctrl_file_fields: list, ctrl_include_header: bool) -> list[dict]:
    """
    Parse a fixed-width control file into column-keyed row dicts.

    _create_ctrl_file writes fields concatenated in declaration order, each padded
    to its length (default 15 for numeric, 20 for string when length=0).  This
    mirrors the exact logic in transformations._create_ctrl_file so the reader
    always matches the writer.

    When ctrl_include_header is True the first line is the field-name header row
    written by _create_ctrl_file; it is skipped before parsing data rows.

    If no ctrl_file_fields are provided the raw lines are returned as {"value": line}.
    """
    _DEFAULT_NUM_LEN = 15
    _DEFAULT_STR_LEN = 20

    lines = [ln.rstrip("\r") for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    if not ctrl_file_fields:
        # No schema — return raw lines for backward compatibility.
        if ctrl_include_header and lines:
            lines = lines[1:]
        return [{"value": line} for line in lines]

    # Build (name, pos, length, is_numeric) slices using same defaults as _create_ctrl_file
    field_slices: list[tuple[str, int, int, bool]] = []
    pos = 0
    for f in ctrl_file_fields:
        name = (f.get("name") or "").strip()
        if not name:
            continue
        ftype = (f.get("type") or "STRING").upper()
        is_numeric = ftype in ("LONG", "INT", "INTEGER", "BIGINT")
        length = int(f.get("length") or 0)
        if not length:
            length = _DEFAULT_NUM_LEN if is_numeric else _DEFAULT_STR_LEN
        field_slices.append((name, pos, length, is_numeric))
        pos += length

    # If ctrl_include_header=True, detect and remove the header line by content
    # rather than blindly skipping line[0] (Spark union ordering is not guaranteed).
    # The header line has the first field name left-justified at position 0.
    if ctrl_include_header and field_slices:
        first_fname, first_start, first_len, _ = field_slices[0]
        header_sentinel = first_fname[:first_len].ljust(first_len)
        lines = [
            l for l in lines
            if l[first_start: first_start + first_len] != header_sentinel
        ]

    if not lines:
        return []

    rows = []
    for line in lines:
        row: dict = {}
        for fname, start, length, is_numeric in field_slices:
            raw = line[start: start + length].strip()
            # Normalize numeric: remove leading zeros so "000000000000005" == "5"
            if is_numeric and raw.lstrip("0"):
                raw = raw.lstrip("0")
            elif is_numeric and raw == "0" * len(raw) and raw:
                raw = "0"
            row[fname] = raw
        rows.append(row)
    return rows


def _read_ctrl_outputs(temp_dir: Path, config: dict) -> dict[str, list[dict]]:
    """
    Read control file outputs from temp_dir/ctrl/<step_id>/ for every validate
    step that has ctrl_file_create enabled.  Returns dict keyed by step_id.

    Each row is returned as a column-keyed dict matching the ctrl_file_fields
    schema (same pattern as output dataset rows), so the reconciliation tab can
    compare generated vs expected using matching column names.
    """
    ctrl_base = temp_dir / "ctrl"
    if not ctrl_base.exists():
        return {}

    trans = config.get("Transformations") or config.get("transformations") or {}
    result: dict[str, list[dict]] = {}
    for step in trans.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if step.get("type") != "validate":
            continue
        logic = step.get("logic") or {}
        if not logic.get("ctrl_file_create"):
            continue
        ctrl_include_header = bool(logic.get("ctrl_include_header", False))
        ctrl_file_fields = logic.get("ctrl_file_fields") or []
        step_id = step.get("id") or "validate"
        ctrl_dir = ctrl_base / step_id
        if not ctrl_dir.exists():
            result[step_id] = []
            continue

        content = ""
        # _create_ctrl_file writes to ctrl/<step_id>/<frequency>/<date>/<name>.CTL
        # Priority 1: named files (non-Spark)
        named_files = sorted(
            f for f in ctrl_dir.rglob("*")
            if f.is_file()
            and not f.name.startswith(".")
            and f.suffix not in (".crc",)
            and f.name != "_SUCCESS"
            and not f.name.startswith("part-")
        )
        # Priority 2: Spark part files (fallback when ctrl_file_name was empty)
        part_files = sorted(
            f for f in ctrl_dir.rglob("part-*")
            if f.is_file() and f.suffix not in (".crc",)
        )
        for ctrl_file in named_files + [f for f in part_files if f not in named_files]:
            try:
                with open(ctrl_file, newline="", encoding="utf-8") as fh:
                    content = fh.read()
            except Exception:
                content = ""
            if content.strip():
                break

        result[step_id] = _parse_ctrl_output(content, ctrl_file_fields, ctrl_include_header)
    return result


def _to_native(obj: Any) -> Any:
    if obj is None:
        return None
    try:
        import pandas as pd
        if hasattr(pd, "isna") and pd.isna(obj):
            return None
    except ImportError:
        pass
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


def run_dataflow_test(
    config: dict,
    config_name: str,
    base_path: Path,
    sample_data: dict | None = None,
    num_sample_rows: int = 5,
) -> dict:
    """
    Run dataflow via dataflow-engine subprocess. Returns dict with error?, outputs, logs.
    """
    engine_dir = _dataflow_engine_dir()
    if not engine_dir:
        return {
            "error": "Dataflow engine not found. Set DATAFLOW_ENGINE_DIR to the dataflow-engine project path, or place it next to parser-engine.",
            "outputs": {},
            "logs": "",
        }
    try:
        temp_dir, config_path, run_base = _prepare_run(
            config, config_name, base_path, sample_data, num_sample_rows
        )
    except Exception as e:
        return {"error": str(e), "outputs": {}, "logs": str(e)}

    run_script = engine_dir / "run_dataflow.py"
    if not run_script.exists():
        return {"error": f"run_dataflow.py not found at {run_script}", "outputs": {}, "logs": ""}

    python_exe = _find_python_with_pyspark(engine_dir)

    try:
        proc = subprocess.run(
            [python_exe, str(run_script), str(config_path), "--base-path", str(run_base), "--no-cobrix",
             "--settings", str(base_path / "static" / "config" / "settings.json")],
            cwd=str(engine_dir),
            capture_output=True,
            text=True,
            timeout=300,
            env=_get_spark_env(),
        )
        logs = (proc.stdout or "") + (proc.stderr or "")
        outputs_raw = _read_outputs(temp_dir, config)
        outputs = {}
        for k, rows in outputs_raw.items():
            outputs[k] = [{key: _to_native(v) for key, v in row.items()} for row in rows]
        ctrl_raw = _read_ctrl_outputs(temp_dir, config)
        ctrl_outputs = {}
        for k, rows in ctrl_raw.items():
            ctrl_outputs[k] = [{key: _to_native(v) for key, v in row.items()} for row in rows]

        if proc.returncode != 0:
            return {
                "error": proc.stderr.strip() or f"Process exited with code {proc.returncode}",
                "outputs": outputs,
                "ctrl_outputs": ctrl_outputs,
                "logs": logs,
            }
        return {"error": None, "outputs": outputs, "ctrl_outputs": ctrl_outputs, "logs": logs}
    except subprocess.TimeoutExpired:
        return {"error": "Dataflow run timed out (300s).", "outputs": {}, "logs": ""}
    except Exception as e:
        return {"error": str(e), "outputs": {}, "logs": str(e)}
    finally:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


def run_dataflow_test_stream(
    config: dict,
    config_name: str,
    base_path: Path,
    sample_data: dict | None = None,
    num_sample_rows: int = 5,
):
    """
    Run dataflow via subprocess and yield stream chunks: "LOG: ..." lines then "RESULT: {...}".
    """
    engine_dir = _dataflow_engine_dir()
    if not engine_dir:
        yield "LOG: Dataflow engine not found. Set DATAFLOW_ENGINE_DIR.\n"
        yield "RESULT: " + json.dumps({
            "error": "Dataflow engine not found. Set DATAFLOW_ENGINE_DIR to the dataflow-engine project path.",
            "outputs": {},
            "ctrl_outputs": {},
        }) + "\n"
        return

    try:
        temp_dir, config_path, run_base = _prepare_run(
            config, config_name, base_path, sample_data, num_sample_rows
        )
    except Exception as e:
        yield "LOG: " + str(e) + "\n"
        yield "RESULT: " + json.dumps({"error": str(e), "outputs": {}, "ctrl_outputs": {}}) + "\n"
        return

    run_script = engine_dir / "run_dataflow.py"
    if not run_script.exists():
        yield "LOG: run_dataflow.py not found\n"
        yield "RESULT: " + json.dumps({"error": "run_dataflow.py not found", "outputs": {}, "ctrl_outputs": {}}) + "\n"
        return

    python_exe = _find_python_with_pyspark(engine_dir)

    proc = None
    try:
        proc = subprocess.Popen(
            [python_exe, str(run_script), str(config_path), "--base-path", str(run_base), "--no-cobrix",
             "--settings", str(base_path / "static" / "config" / "settings.json")],
            cwd=str(engine_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=_get_spark_env(),
        )
        if proc.stdout:
            for line in proc.stdout:
                # Suppress noisy cloudpickle/PySpark serialisation diagnostics
                # ("when serializing function/tuple/object") — internal pickle
                # tracing messages that are not useful to the user.
                if "when serializing" in line:
                    continue
                yield "LOG: " + line
        proc.wait(timeout=300)
        outputs_raw = _read_outputs(temp_dir, config)
        outputs = {}
        for k, rows in outputs_raw.items():
            outputs[k] = [{key: _to_native(v) for key, v in row.items()} for row in rows]
        ctrl_raw = _read_ctrl_outputs(temp_dir, config)
        ctrl_outputs = {}
        for k, rows in ctrl_raw.items():
            ctrl_outputs[k] = [{key: _to_native(v) for key, v in row.items()} for row in rows]
        err = None
        if proc.returncode != 0:
            err = f"Process exited with code {proc.returncode}"
        yield "RESULT: " + json.dumps({"error": err, "outputs": outputs, "ctrl_outputs": ctrl_outputs}) + "\n"
    except subprocess.TimeoutExpired:
        if proc:
            proc.kill()
        yield "RESULT: " + json.dumps({"error": "Dataflow run timed out (300s).", "outputs": {}, "ctrl_outputs": {}}) + "\n"
    except Exception as e:
        yield "RESULT: " + json.dumps({"error": str(e), "outputs": {}, "ctrl_outputs": {}}) + "\n"
    finally:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
