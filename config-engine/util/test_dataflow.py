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


def generate_sample_data(config: dict, num_rows: int = 5) -> dict[str, list[dict]]:
    """
    Generate minimal sample input data from config schema (Inputs.fields).
    Returns dict mapping input name -> list of row dicts.
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
            # Keep schema column names as-is (including hyphen and *)
            cols = [f.get("name") or f"col_{i}" for i, f in enumerate(fields) if isinstance(f, dict)]
            if not cols:
                cols = ["id"]
            rows = []
            for i in range(max(1, num_rows)):
                row = {}
                for j, c in enumerate(cols):
                    if c.lower() in ("id", "key"):
                        row[c] = i
                    else:
                        row[c] = f"val_{i}" if j == 0 else i
                rows.append(row)
        out[name] = rows
    return out


def _prepare_run(
    config: dict,
    config_name: str,
    base_path: Path,
    sample_data: dict | None,
    num_sample_rows: int,
) -> tuple[Path, Path, Path]:
    """
    Write config and sample data to a temp dir. Returns (temp_dir, config_path, base_path).
    Config is modified so Inputs point to temp/input/NAME.csv and Outputs to temp/output/NAME.
    """
    temp_dir = Path(tempfile.mkdtemp(prefix="parser_test_"))
    input_dir = temp_dir / "input"
    output_dir = temp_dir / "output"
    input_dir.mkdir()
    output_dir.mkdir()

    cfg = json.loads(json.dumps(config))
    inputs = cfg.get("Inputs") or cfg.get("inputs") or {}
    outputs = cfg.get("Outputs") or cfg.get("outputs") or {}

    if sample_data:
        for name, rows in sample_data.items():
            path = input_dir / f"{name}.csv"
            if rows:
                with open(path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                    writer.writeheader()
                    writer.writerows(rows)
            else:
                path.touch()
            inp_cfg = inputs.get(name)
            if isinstance(inp_cfg, dict):
                inp_cfg["path"] = f"input/{name}.csv"
                inp_cfg["format"] = "csv"
    else:
        sample = generate_sample_data(cfg, num_rows=num_sample_rows)
        for name, rows in sample.items():
            path = input_dir / f"{name}.csv"
            if rows:
                with open(path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                    writer.writeheader()
                    writer.writerows(rows)
            else:
                path.touch()
            inp_cfg = inputs.get(name)
            if isinstance(inp_cfg, dict):
                inp_cfg["path"] = f"input/{name}.csv"
                inp_cfg["format"] = "csv"

    for name in outputs:
        out_cfg = outputs.get(name)
        if isinstance(out_cfg, dict):
            out_cfg["path"] = f"output/{name}"
            out_cfg["format"] = "parquet"

    config_path = temp_dir / "config.json"
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return temp_dir, config_path, temp_dir


def _read_outputs(temp_dir: Path, config: dict) -> dict[str, list[dict]]:
    """Read output parquet/csv from temp_dir/output into dict of name -> list of rows."""
    output_dir = temp_dir / "output"
    outputs_cfg = config.get("Outputs") or config.get("outputs") or {}
    result: dict[str, list[dict]] = {}
    for name in outputs_cfg:
        # Spark writes parquet to a directory (e.g. output/SUMCOPY/)
        parquet_dir = output_dir / name
        csv_path = output_dir / f"{name}.csv"
        if parquet_dir.exists() and parquet_dir.is_dir():
            try:
                import pandas as pd
                df = pd.read_parquet(parquet_dir)
                result[name] = df.to_dict(orient="records")
            except Exception:
                result[name] = []
        elif csv_path.exists():
            try:
                with open(csv_path, newline="", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    result[name] = list(reader)
            except Exception:
                result[name] = []
        else:
            result[name] = []
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

    try:
        proc = subprocess.run(
            [sys.executable, str(run_script), str(config_path), "--base-path", str(run_base), "--no-cobrix"],
            cwd=str(engine_dir),
            capture_output=True,
            text=True,
            timeout=300,
        )
        logs = (proc.stdout or "") + (proc.stderr or "")
        outputs_raw = _read_outputs(temp_dir, config)
        outputs = {}
        for k, rows in outputs_raw.items():
            outputs[k] = [{key: _to_native(v) for key, v in row.items()} for row in rows]

        if proc.returncode != 0:
            return {
                "error": proc.stderr.strip() or f"Process exited with code {proc.returncode}",
                "outputs": outputs,
                "logs": logs,
            }
        return {"error": None, "outputs": outputs, "logs": logs}
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
        }) + "\n"
        return

    try:
        temp_dir, config_path, run_base = _prepare_run(
            config, config_name, base_path, sample_data, num_sample_rows
        )
    except Exception as e:
        yield "LOG: " + str(e) + "\n"
        yield "RESULT: " + json.dumps({"error": str(e), "outputs": {}}) + "\n"
        return

    run_script = engine_dir / "run_dataflow.py"
    if not run_script.exists():
        yield "LOG: run_dataflow.py not found\n"
        yield "RESULT: " + json.dumps({"error": "run_dataflow.py not found", "outputs": {}}) + "\n"
        return

    proc = None
    try:
        proc = subprocess.Popen(
            [sys.executable, str(run_script), str(config_path), "--base-path", str(run_base), "--no-cobrix"],
            cwd=str(engine_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if proc.stdout:
            for line in proc.stdout:
                yield "LOG: " + line
        proc.wait(timeout=300)
        outputs_raw = _read_outputs(temp_dir, config)
        outputs = {}
        for k, rows in outputs_raw.items():
            outputs[k] = [{key: _to_native(v) for key, v in row.items()} for row in rows]
        err = None
        if proc.returncode != 0:
            err = f"Process exited with code {proc.returncode}"
        yield "RESULT: " + json.dumps({"error": err, "outputs": outputs}) + "\n"
    except subprocess.TimeoutExpired:
        if proc:
            proc.kill()
        yield "RESULT: " + json.dumps({"error": "Dataflow run timed out (300s).", "outputs": {}}) + "\n"
    except Exception as e:
        yield "RESULT: " + json.dumps({"error": str(e), "outputs": {}}) + "\n"
    finally:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
