"""
Import mainframe code from a ZIP file and generate config JSON (Parser Engine).

Extracts the ZIP to a temporary directory, discovers JCL/PROC/COBOL/copybook files
recursively (single folder or multiple subfolders, e.g. cobol/, copybooks/),
runs the rule-based mainframe parser, and returns the config plus discovery summary.

Optional: if the ZIP contains folders "input/" and "output/" (or "expected_output/")
with CSV or Parquet files named to match config Input/Output names (e.g. TRANSACTIONS.csv,
DAILY_REVENUE.parquet), they are parsed and returned as input_data and expected_output
for use in testing and reconciliation.
"""

import csv
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional, Tuple

from mainframe_parser.engine import MainframeConfigEngine
from mainframe_parser.file_discovery import discover_mainframe_files

LOG = logging.getLogger("zip_import")

# Max rows to load per dataset from zip (to avoid huge payloads)
MAX_UPLOADED_ROWS = 2000


def _to_native(obj: Any) -> Any:
    """Convert numpy/pandas types to native Python for JSON."""
    if obj is None:
        return None
    try:
        import numpy as np
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        import pandas as pd
        if hasattr(pd, "isna") and pd.isna(obj):
            return None
        if hasattr(obj, "isoformat"):
            return obj.isoformat()
    except ImportError:
        pass
    return obj


def _find_dir_case_insensitive(parent: Path, name: str) -> Optional[Path]:
    """Find a direct child directory of parent whose name equals name (case-insensitive)."""
    if not parent.exists() or not parent.is_dir():
        return None
    lower = name.lower()
    for child in parent.iterdir():
        if child.is_dir() and child.name.lower() == lower:
            return child
    return None


def _all_subdirs_up_to_depth(root: Path, max_depth: int) -> List[Path]:
    """Return root and all subdirs within max_depth (1 = root + children, 2 = + grandchildren)."""
    out: List[Path] = [root]
    if max_depth < 1:
        return out
    try:
        for child in root.iterdir():
            if child.is_dir():
                out.append(child)
                if max_depth >= 2:
                    for grand in child.iterdir():
                        if grand.is_dir():
                            out.append(grand)
    except OSError:
        pass
    return out


def _resolve_input_output_roots(extracted_dir: Path) -> Tuple[Optional[Path], Optional[Path]]:
    """
    Resolve (input_root, output_root) from extracted zip.
    Looks for input/ and output/ (or expected_output/) case-insensitively,
    at extracted_dir root or inside any subdir up to 2 levels (e.g. ENTERPRISE_BANK_BATCH/INPUT).
    """
    all_dirs = _all_subdirs_up_to_depth(extracted_dir, 2)
    inp_root = None
    out_root = None
    for d in all_dirs:
        if d.name.lower() == "input":
            inp_root = d
        elif d.name.lower() in ("output", "expected_output", "expected"):
            out_root = d
        if inp_root and out_root:
            break
    if inp_root is None or out_root is None:
        for d in all_dirs:
            if d.name.lower() == "data":
                if inp_root is None:
                    inp_root = _find_dir_case_insensitive(d, "input")
                if out_root is None:
                    out_root = _find_dir_case_insensitive(d, "output") or _find_dir_case_insensitive(d, "expected_output")
                if inp_root and out_root:
                    break
    if inp_root:
        LOG.info("Resolved input folder from ZIP: %s", inp_root)
    if out_root:
        LOG.info("Resolved output folder from ZIP: %s", out_root)
    return inp_root, out_root


def _read_csv_fallback(path: Path) -> List[dict]:
    """Read CSV using stdlib csv (no pandas). Limited to MAX_UPLOADED_ROWS."""
    rows: List[dict] = []
    try:
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                if i >= MAX_UPLOADED_ROWS:
                    break
                rows.append({k: _to_native(v) for k, v in row.items()})
    except Exception as e:
        LOG.warning("Could not read CSV %s: %s", path, e)
    return rows


def _read_test_data_from_extracted_zip(
    extracted_dir: Path,
    config_dict: dict,
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]]]:
    """
    Read optional input/ and output/ (or expected_output/) folders from extracted zip.
    Looks for INPUT/OUTPUT (case-insensitive) at root or inside a top-level folder (e.g. ENTERPRISE_BANK_BATCH/).
    Files must be named to match config Input/Output names (e.g. ACCTCOPY.csv, SUMCOPY.csv).
    Returns (input_data, expected_output); each is name -> list of row dicts.
    """
    inputs_cfg = config_dict.get("Inputs") or config_dict.get("inputs") or {}
    outputs_cfg = config_dict.get("Outputs") or config_dict.get("outputs") or {}
    input_names = list(inputs_cfg.keys()) if isinstance(inputs_cfg, dict) else []
    output_names = list(outputs_cfg.keys()) if isinstance(outputs_cfg, dict) else []

    def _find_file(dir_path: Path, name: str, dataset: Optional[str] = None) -> Optional[Path]:
        """Find a file by config name or by dataset (DSN) so INPUT/PROD.BANK.TXN.DAILY is found when name is TXN."""
        if not dir_path.exists() or not dir_path.is_dir():
            return None
        for candidate in [name, dataset] if dataset else [name]:
            if not candidate:
                continue
            for ext in ("", ".csv", ".parquet", ".dat", ".txt", ".fixed"):
                p = dir_path / f"{candidate}{ext}"
                if p.exists() and p.is_file():
                    return p
        for ext in (".csv", ".parquet", ".dat", ".txt", ".fixed", ""):
            for f in dir_path.iterdir():
                if not f.is_file():
                    continue
                stem = f.stem.upper()
                fn = f.name.upper()
                if stem == name.upper() or (dataset and (stem == dataset.upper() or fn == dataset.upper())):
                    return f
        return None

    def _read_dataset(path: Path, node_cfg: Optional[dict] = None) -> List[dict]:
        try:
            # Check if this is a FIXED format file based on config
            fmt = ""
            fields = []
            if isinstance(node_cfg, dict):
                fmt = (node_cfg.get("format") or "").strip().upper()
                fields = node_cfg.get("fields") or []
            if fmt == "FIXED" and fields:
                text = path.read_text(encoding="utf-8", errors="replace")
                rows = []
                for line in text.splitlines():
                    line = line.rstrip("\r")
                    if not line:
                        continue
                    if len(rows) >= MAX_UPLOADED_ROWS:
                        break
                    row = {}
                    for f in fields:
                        fname = f.get("name") or ""
                        start = int(f.get("start") or 1) - 1  # 1-based → 0-based
                        length = int(f.get("length") or 1)
                        row[fname] = line[start: start + length].strip()
                    rows.append(row)
                return rows
            if path.suffix.lower() == ".parquet":
                try:
                    import pandas as pd
                    df = pd.read_parquet(path)
                    df = df.head(MAX_UPLOADED_ROWS)
                    rows = df.to_dict(orient="records")
                    return [{k: _to_native(v) for k, v in row.items()} for row in rows]
                except ImportError:
                    LOG.warning("Parquet file %s requires pandas; skipping", path)
                    return []
            else:
                try:
                    import pandas as pd
                    df = pd.read_csv(path, nrows=MAX_UPLOADED_ROWS)
                    rows = df.to_dict(orient="records")
                    return [{k: _to_native(v) for k, v in row.items()} for row in rows]
                except ImportError:
                    return _read_csv_fallback(path)
        except Exception as e:
            LOG.warning("Could not read %s: %s", path, e)
            return []

    inp_root, out_root = _resolve_input_output_roots(extracted_dir)

    def _get_dataset(cfg: dict, name: str) -> Optional[str]:
        entry = cfg.get(name) if isinstance(cfg.get(name), dict) else None
        if not entry:
            return None
        return entry.get("dataset") or entry.get("Dataset") or entry.get("dsn")

    input_data: Dict[str, List[dict]] = {}
    if inp_root is not None:
        for name in input_names:
            dataset = _get_dataset(inputs_cfg, name)
            p = _find_file(inp_root, name, dataset)
            if p:
                ncfg = inputs_cfg.get(name) if isinstance(inputs_cfg.get(name), dict) else None
                input_data[name] = _read_dataset(p, ncfg)
                LOG.info("Loaded input %s: %d rows from %s", name, len(input_data[name]), p.name)

    expected_output: Dict[str, List[dict]] = {}
    if out_root is not None:
        for name in output_names:
            dataset = _get_dataset(outputs_cfg, name)
            p = _find_file(out_root, name, dataset)
            if p:
                ncfg = outputs_cfg.get(name) if isinstance(outputs_cfg.get(name), dict) else None
                expected_output[name] = _read_dataset(p, ncfg)
                LOG.info("Loaded expected output %s: %d rows from %s", name, len(expected_output[name]), p.name)

    return input_data, expected_output


def _read_file_contents(paths: List[Path], max_chars: int = 50000) -> str:
    """Read and concatenate file contents up to max_chars total."""
    out: List[str] = []
    total = 0
    for p in paths:
        if total >= max_chars:
            break
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
            take = min(len(text), max_chars - total)
            out.append(f"=== {p.name} ===\n" + text[:take])
            total += take + len(p.name) + 10
        except Exception:
            continue
    return "\n\n".join(out)


def _apply_dataset_path_prefixes(
    config_dict: dict,
    input_prefix: str,
    output_prefix: str,
) -> None:
    """Set path in each Input/Output to prefix + dataset name. Modifies config_dict in place."""
    input_prefix = (input_prefix or "").strip().rstrip("/")
    output_prefix = (output_prefix or "").strip().rstrip("/")
    if not input_prefix and not output_prefix:
        return
    inputs = config_dict.get("Inputs") or config_dict.get("inputs") or {}
    outputs = config_dict.get("Outputs") or config_dict.get("outputs") or {}
    for name, cfg in inputs.items():
        if isinstance(cfg, dict):
            cfg["path"] = f"{input_prefix}/{name}" if input_prefix else cfg.get("path", name)
    for name, cfg in outputs.items():
        if isinstance(cfg, dict):
            cfg["path"] = f"{output_prefix}/{name}" if output_prefix else cfg.get("path", name)


def generate_config_from_zip(
    zip_path_or_file,  # type: Union[str, Path, BinaryIO]
    base_s3_path: str = "s3://migration-bucket/data",
    input_dataset_prefix: Optional[str] = None,
    output_dataset_prefix: Optional[str] = None,
    use_llm: bool = False,
    llm_base_url: Optional[str] = None,
    llm_model: Optional[str] = None,
    llm_timeout_seconds: int = 600,
    log_sink: Optional[list] = None,
) -> dict:
    """
    Generate PySpark dataflow config JSON from a ZIP of mainframe artifacts.

    The ZIP can be:
    - Single folder: all .jcl, .cbl, .cpy etc. in one directory.
    - Multiple subfolders: e.g. cobol/, copybooks/, jcl/ with files in each.
    Files are discovered recursively in all subfolders.

    Args:
        zip_path_or_file: Path to a .zip file, or a file-like object (e.g. from request.files).
        base_s3_path: Base path for dataset references (used when prefixes not set).
        input_dataset_prefix: Prefix for input dataset paths (e.g. file:///tmp/input or s3://bucket/input).
        output_dataset_prefix: Prefix for output dataset paths (e.g. file:///tmp/output or s3://bucket/output).
        use_llm: If True and LLM is configured (OPENAI_API_KEY or LLM_API_KEY), use LLM to generate config.

    Returns:
        Dict with "config" (Inputs, Outputs, Transformations) and "discovery"
        (counts: jcl, proc, cobol, copybook). If use_llm was used, discovery has "llm": True.
    """
    engine = MainframeConfigEngine()

    with tempfile.TemporaryDirectory(prefix="mainframe_zip_") as tmpdir:
        tmp = Path(tmpdir)

        if hasattr(zip_path_or_file, "read"):
            with zipfile.ZipFile(zip_path_or_file, "r") as zf:
                zf.extractall(tmp)
        else:
            path = Path(zip_path_or_file)
            if not path.exists():
                raise FileNotFoundError(f"ZIP file not found: {path}")
            with zipfile.ZipFile(path, "r") as zf:
                zf.extractall(tmp)

        jcl_paths, proc_paths, cobol_paths, copybook_paths = discover_mainframe_files(tmp)
        all_jcl = (jcl_paths or []) + (proc_paths or [])

        if not all_jcl and not (cobol_paths or []):
            raise ValueError(
                "No mainframe files found in ZIP. Expected at least one of: "
                ".jcl, .proc/.prc, .cbl/.cob/.cobol (in root or subfolders)"
            )

        config_dict = None
        used_llm = False
        if not use_llm and log_sink is not None:
            log_sink.append("Use LLM is OFF; using rule-based Python parser.")
        if use_llm:
            if log_sink is not None:
                log_sink.append("Use LLM is ON; calling LLM to generate config...")
            try:
                from llm_config_generator import generate_config_with_llm
                jcl_content = _read_file_contents(all_jcl) if all_jcl else ""
                cobol_content = _read_file_contents(cobol_paths or []) if cobol_paths else ""
                copybook_content = _read_file_contents(copybook_paths or []) if copybook_paths else ""
                config_dict = generate_config_with_llm(
                    jcl_content=jcl_content,
                    cobol_content=cobol_content,
                    copybook_content=copybook_content,
                    base_s3_path=base_s3_path,
                    llm_base_url=llm_base_url,
                    llm_model=llm_model,
                    timeout_seconds=llm_timeout_seconds,
                    log_sink=log_sink,
                )
                if config_dict and (input_dataset_prefix or output_dataset_prefix):
                    _apply_dataset_path_prefixes(
                        config_dict,
                        input_dataset_prefix or base_s3_path,
                        output_dataset_prefix or base_s3_path,
                    )
                if config_dict:
                    used_llm = True
                    LOG.info("Config generated using LLM")
                    if log_sink is not None:
                        log_sink.append("Config generated using LLM.")
                else:
                    LOG.warning("LLM returned no config; falling back to rule-based parser")
                    if log_sink is not None:
                        log_sink.append("LLM returned no config; falling back to rule-based parser.")
            except ImportError:
                LOG.warning("llm_config_generator not available; falling back to rule-based parser")
                if log_sink is not None:
                    log_sink.append("llm_config_generator not available; falling back to rule-based parser.")
            except Exception as e:
                LOG.warning("LLM config generation failed, falling back to rule-based: %s", e)
                if log_sink is not None:
                    log_sink.append(f"LLM config generation failed: {e}; falling back to rule-based parser.")

        if config_dict is None:
            if log_sink is not None:
                log_sink.append("Using rule-based Python parser.")
            config = engine.generate_config(
                jcl_paths=jcl_paths or None,
                proc_paths=proc_paths or None,
                cobol_paths=cobol_paths or None,
                copybook_paths=copybook_paths or None,
                base_s3_path=base_s3_path,
                input_path_prefix=input_dataset_prefix or None,
                output_path_prefix=output_dataset_prefix or None,
            )
            config_dict = config.to_json_config()
        elif input_dataset_prefix or output_dataset_prefix:
            _apply_dataset_path_prefixes(
                config_dict,
                input_dataset_prefix or base_s3_path,
                output_dataset_prefix or base_s3_path,
            )
        def _unique_count(paths: list) -> int:
            """Count unique files by filename (case-insensitive). One count per name so no duplicates in UI."""
            if not paths:
                return 0
            return len({getattr(p, "name", str(p)).lower() for p in paths})

        discovery = {
            "jcl": _unique_count(jcl_paths),
            "proc": _unique_count(proc_paths),
            "cobol": _unique_count(cobol_paths),
            "copybook": _unique_count(copybook_paths),
            "llm": used_llm,
        }

        result = {
            "config": config_dict,
            "discovery": discovery,
        }
        if log_sink is not None:
            result["logs"] = log_sink

        input_data, expected_output = _read_test_data_from_extracted_zip(tmp, config_dict)
        inp_root, out_root = _resolve_input_output_roots(tmp)
        result["test_data_summary"] = {
            "input_folder_found": inp_root is not None,
            "output_folder_found": out_root is not None,
            "input_files": list(input_data.keys()) if input_data else [],
            "output_files": list(expected_output.keys()) if expected_output else [],
        }
        if input_data:
            result["input_data"] = input_data
        if expected_output:
            result["expected_output"] = expected_output
        if log_sink is not None:
            if input_data or expected_output:
                inp_list = ", ".join(sorted(input_data.keys())) if input_data else "none"
                out_list = ", ".join(sorted(expected_output.keys())) if expected_output else "none"
                log_sink.append(f"Test data in ZIP: input={inp_list}, expected_output={out_list}.")
            else:
                log_sink.append("Test data: no INPUT/OUTPUT (or expected_output) folders with matching CSV/Parquet found in ZIP.")

        return result
