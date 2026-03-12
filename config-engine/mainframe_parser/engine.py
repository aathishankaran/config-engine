"""
Main orchestration engine for mainframe to PySpark config generation.

Uses rule-based parsers (JCL, PROC, Copybook, COBOL) only to produce the configuration JSON.

Dataset names and config keys (input/output names) come from JCL, PROC, or COBOL:
- JCL/PROC DD statements provide DD names and DSN (e.g. TXN, PROD.BANK.TXN.DAILY).
- COBOL SELECT...ASSIGN TO provides DD names when JCL is absent; FD COPY links DD to copybook.
Copybooks are used only for schema (field definitions), not for naming inputs/outputs.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional

from .schema import (
    DataFlowConfig,
    InputConfig,
    OutputConfig,
    TransformationConfig,
    TransformationStep,
)
from .parsers.jcl_parser import JCLParser
from .parsers.copybook_parser import CopybookParser
from .parsers.cobol_parser import COBOLParser
from .parsers.cobol_transformation_extractor import COBOLTransformationExtractor

LOG = logging.getLogger("mainframe_parser")


def _normalize_copybook_stem(stem: str) -> str:
    """Strip macOS resource-fork / AppleDouble prefix so ._ACCTCOPY -> ACCTCOPY."""
    s = (stem or "").strip()
    if s.startswith("._"):
        return s[2:].strip() or s
    return s


def _filter_procs_for_cobol(
    proc_paths: List[Path],
    cobol_paths: List[Path],
) -> List[Path]:
    """
    Return only the PROC files that explicitly run one of our COBOL programs
    via an ``EXEC PGM=<program-name>`` statement.

    This eliminates utility / backup PROCs (e.g. GENBKUP02, GENDATCHK) whose
    DD statements would otherwise flood the config with irrelevant inputs and
    outputs.  Falls back to all proc_paths when no match is found (safety net).
    """
    if not cobol_paths or not proc_paths:
        return proc_paths
    cobol_stems = {p.stem.upper() for p in cobol_paths}
    relevant: List[Path] = []
    for pp in proc_paths:
        try:
            content = pp.read_text(encoding="utf-8", errors="ignore").upper()
            if any(f"PGM={stem}" in content for stem in cobol_stems):
                relevant.append(pp)
        except OSError:
            continue
    # Only apply the filter when we actually found matching PROCs
    return relevant if relevant else proc_paths


class MainframeConfigEngine:
    """
    Engine to convert mainframe artifacts into PySpark configuration JSON.

    Rule-based parsing only: JCL, PROC, Copybook, and COBOL transformation extractor.
    """

    def __init__(self) -> None:
        self.jcl_parser = JCLParser()
        self.copybook_parser = CopybookParser()
        self.cobol_parser = COBOLParser()

    def generate_config(
        self,
        jcl_paths: Optional[List[Path]] = None,
        proc_paths: Optional[List[Path]] = None,
        cobol_paths: Optional[List[Path]] = None,
        copybook_paths: Optional[List[Path]] = None,
        copybook_mapping: Optional[Dict[str, Path]] = None,
        dd_copybook_mapping: Optional[Dict[str, str]] = None,
        base_s3_path: str = "s3://migration-bucket/data",
        input_path_prefix: Optional[str] = None,
        output_path_prefix: Optional[str] = None,
    ) -> DataFlowConfig:
        """
        Generate configuration from mainframe artifact paths.

        Args:
            jcl_paths: Paths to JCL files
            proc_paths: Paths to PROC files
            cobol_paths: Paths to COBOL programs
            copybook_paths: Paths to copybook files
            copybook_mapping: Map copybook name -> path for schema loading
            dd_copybook_mapping: Map DD name -> copybook name (e.g. {"INPUT1": "sample"})
            base_s3_path: Base path for datasets (used for both I/O if prefixes not set)
            input_path_prefix: Prefix for input dataset paths (overrides base_s3_path for inputs)
            output_path_prefix: Prefix for output dataset paths (overrides base_s3_path for outputs)

        Returns:
            DataFlowConfig for PySpark framework
        """
        input_base = (input_path_prefix or base_s3_path).strip() or base_s3_path
        output_base = (output_path_prefix or base_s3_path).strip() or base_s3_path
        config = DataFlowConfig(
            name="mainframe_migration",
            description="Generated from mainframe artifacts",
        )

        # 1. Parse JCL/PROC for inputs and outputs
        LOG.info("Parsing JCL and PROC files...")
        all_inputs: Dict[str, InputConfig] = {}
        all_outputs: Dict[str, OutputConfig] = {}

        # Filter PROC files to only those that execute one of our COBOL programs.
        # This excludes utility/backup PROCs (e.g. GENBKUP02, GENDATCHK) whose DD
        # statements would otherwise introduce irrelevant inputs and outputs.
        if cobol_paths and proc_paths:
            filtered_procs = _filter_procs_for_cobol(proc_paths, cobol_paths)
            if len(filtered_procs) < len(proc_paths):
                LOG.info(
                    "  -> Filtered PROCs: %d → %d (keeping only those running COBOL programs)",
                    len(proc_paths),
                    len(filtered_procs),
                )
                proc_paths = filtered_procs

        for path in (jcl_paths or []) + (proc_paths or []):
            inputs, outputs = self.jcl_parser.parse_file(path)
            for inp in inputs:
                all_inputs[inp.name] = inp
            for out in outputs:
                all_outputs[out.name] = out

        LOG.info("  -> Found %d input(s), %d output(s)", len(all_inputs), len(all_outputs))

        # 1b. Build DD -> copybook name from COBOL FD + SELECT (DD names from JCL/COBOL; copybooks for schema only)
        dd_copybook_from_cobol: Dict[str, str] = {}
        for path in cobol_paths or []:
            try:
                fds, selects = self.cobol_parser.parse_file(path)
            except Exception as e:
                LOG.warning("Skipping COBOL file %s: %s", path, e)
                continue
            fd_by_name: Dict[str, Optional[str]] = {}
            for fd in fds:
                key = fd.fd_name.upper()
                fd_by_name[key] = fd.copybook
            for sel in selects:
                if not sel.dd_name:
                    continue
                file_key = sel.file_name.upper()
                copybook_name = fd_by_name.get(file_key)
                if copybook_name:
                    dd_copybook_from_cobol[sel.dd_name] = copybook_name
        if dd_copybook_from_cobol:
            LOG.info("  -> COBOL FD/SELECT mapped %d DD(s) to copybook names (schema only)", len(dd_copybook_from_cobol))

        # When JCL has no inputs/outputs: infer from COBOL (DD names), not from copybook file names.
        # Dataset names and config keys come from JCL/PROC/COBOL; copybooks are for schema only.
        if not all_inputs and not all_outputs and dd_copybook_from_cobol:
            in_dd_names: List[str] = []
            out_dd_names: List[str] = []
            out_marks = ("SUM", "OUT", "SUMMARY", "RPT", "REPORT", "WRITE", "TARGET")
            in_marks = ("TXN", "IN", "INPUT", "DAILY", "FILE", "READ", "SOURCE", "COPY", "CNTL")
            for dd_name, copybook in dd_copybook_from_cobol.items():
                cb_upper = (copybook or "").upper()
                dd_upper = dd_name.upper()
                if any(m in cb_upper or m in dd_upper for m in out_marks):
                    out_dd_names.append(dd_name)
                elif any(m in cb_upper or m in dd_upper for m in in_marks):
                    in_dd_names.append(dd_name)
                else:
                    in_dd_names.append(dd_name)
            if not in_dd_names and not out_dd_names:
                in_dd_names = list(dd_copybook_from_cobol.keys())[:1]
                out_dd_names = list(dd_copybook_from_cobol.keys())[1:2]
            if not out_dd_names and len(dd_copybook_from_cobol) >= 2:
                out_dd_names = [k for k in dd_copybook_from_cobol if k not in in_dd_names][:1]
            for dd in in_dd_names:
                all_inputs[dd] = InputConfig(name=dd, format="cobol", metadata={"inferred": "from COBOL SELECT/FD (DD name)"})
            for dd in out_dd_names:
                all_outputs[dd] = OutputConfig(name=dd, format="parquet", write_mode="overwrite", metadata={"inferred": "from COBOL SELECT/FD (DD name)"})
            if all_inputs or all_outputs:
                LOG.info("  -> Inferred input(s)=%s, output(s)=%s from COBOL (DD names); copybooks used for schema only", list(all_inputs.keys()), list(all_outputs.keys()))
        if not all_inputs and not all_outputs and (copybook_paths or cobol_paths):
            stems = sorted({_normalize_copybook_stem(p.stem).upper() for p in (copybook_paths or [])})
            if stems:
                # Prefer TXN/DAILY for input (e.g. TXNCOPY), not ACCTCOPY; prefer SUM/SUMMARY for output (e.g. SUMCOPY)
                inp_name = (
                    next((s for s in stems if "TXN" in s or "DAILY" in s), None)
                    or next((s for s in stems if "IN" in s and "OUT" not in s), None)
                    or next((s for s in stems if "COPY" in s), stems[0])
                )
                out_name = (
                    next((s for s in reversed(stems) if "SUM" in s or "SUMMARY" in s or "RPT" in s), None)
                    or next((s for s in reversed(stems) if "OUT" in s), None)
                    or (stems[-1] if len(stems) > 1 else "OUTPUT1")
                )
                if inp_name == out_name:
                    out_name = stems[-1] if len(stems) > 1 else "OUTPUT1"
                if inp_name == out_name:
                    out_name = "OUTPUT1"
                all_inputs[inp_name] = InputConfig(name=inp_name, format="cobol", metadata={"inferred": "from copybook stems (no JCL/COBOL DDs)"})
                all_outputs[out_name] = OutputConfig(name=out_name, format="parquet", write_mode="overwrite", metadata={"inferred": "from copybook stems (no JCL/COBOL DDs)"})
                LOG.info("  -> Fallback: inferred 1 input (%s) and 1 output (%s) from copybook file names", inp_name, out_name)
            else:
                all_inputs["INPUT1"] = InputConfig(name="INPUT1", format="fixed", metadata={"inferred": "placeholder"})
                all_outputs["OUTPUT1"] = OutputConfig(name="OUTPUT1", format="parquet", write_mode="overwrite", metadata={"inferred": "placeholder"})
                LOG.info("  -> Added placeholder input/output so COBOL logic can be extracted")

        # 2. Parse copybooks and enrich schema
        LOG.info("Parsing copybooks...")
        copybook_cache: Dict[str, list] = {}
        for path in copybook_paths or []:
            fields = self.copybook_parser.parse_file(path)
            key = _normalize_copybook_stem(path.stem).upper()
            # Prefer real file over macOS ._ resource-fork entry when both exist
            if key not in copybook_cache or not path.stem.startswith("._"):
                copybook_cache[key] = fields

        if copybook_mapping:
            for name, path in copybook_mapping.items():
                fields = self.copybook_parser.parse_file(path)
                copybook_cache[name.upper()] = fields

        copybook_path_map: Dict[str, Path] = {}
        for path in copybook_paths or []:
            key = _normalize_copybook_stem(path.stem).upper()
            if key not in copybook_path_map or not path.stem.startswith("._"):
                copybook_path_map[key] = path
        if copybook_mapping:
            for name, path in copybook_mapping.items():
                copybook_path_map[name.upper()] = path

        dd_copybook = dict(dd_copybook_mapping or {})
        dd_copybook.update(dd_copybook_from_cobol)
        if copybook_path_map:
            copybook_stems = {s.upper() for s in copybook_path_map.keys()}
            for inp in all_inputs.values():
                if inp.name not in dd_copybook and inp.name.upper() in copybook_stems:
                    dd_copybook[inp.name] = inp.name
            for out in all_outputs.values():
                if out.name not in dd_copybook and out.name.upper() in copybook_stems:
                    dd_copybook[out.name] = out.name

        for inp in all_inputs.values():
            copybook_name = inp.copybook or dd_copybook.get(inp.name)
            if copybook_name and copybook_name.upper() in copybook_cache:
                inp.fields = copybook_cache[copybook_name.upper()]
                inp.copybook = copybook_name
                inp.format = "cobol"
                # cobrix block (copybook_path etc.) is not written to config; use copybook name + runtime path at run time
            inp.s3_path = self._s3_path(inp.dataset or inp.name, input_base)

        for out in all_outputs.values():
            copybook_name = out.copybook or dd_copybook.get(out.name)
            if copybook_name and copybook_name.upper() in copybook_cache:
                out.fields = copybook_cache[copybook_name.upper()]
                out.copybook = copybook_name
                if out.fields:
                    # Keep original field names (including hyphen) in schema
                    names = [f.name for f in out.fields if f.name]
                    out.output_columns = names
            out.s3_path = self._s3_path(out.dataset or out.name, output_base)

        config.inputs = all_inputs
        config.outputs = all_outputs

        # 3. Rule-based COBOL transformation extraction
        LOG.info("Extracting transformations from COBOL (rule-based)...")
        input_names = list(all_inputs.keys())
        output_names = list(all_outputs.keys())
        cobol_extractor = COBOLTransformationExtractor()
        extracted = cobol_extractor.extract_from_files(
            (cobol_paths or []),
            input_names,
            output_names,
        )
        if extracted and extracted.steps:
            # Ensure every output has a producing step (fixes diagram: no disconnected output nodes)
            config.transformations = self._ensure_all_outputs_covered(
                extracted, output_names, input_names
            )
            LOG.info(
                "  -> Extracted %d transformation step(s) (%d total after covering all outputs)",
                len(extracted.steps),
                len(config.transformations.steps),
            )
        else:
            config.transformations = self._create_passthrough_transformations(
                all_inputs, all_outputs
            )

        return config

    def _ensure_all_outputs_covered(
        self,
        extracted: TransformationConfig,
        output_names: List[str],
        input_names: List[str],
    ) -> TransformationConfig:
        """Add pass-through steps for any output that no extracted step produces."""
        steps = list(extracted.steps or [])
        produced = {s.output_alias for s in steps if getattr(s, "output_alias", None)}
        # Prefer feeding from the first step's output so flow is: inputs → step → all outputs
        source_for_orphans = None
        if steps and steps[0].output_alias:
            source_for_orphans = steps[0].output_alias
        elif input_names and input_names[0] != "(no JCL inputs)":
            source_for_orphans = input_names[0]
        for out in output_names:
            if not out or out == "(no JCL outputs)" or out in produced:
                continue
            steps.append(
                TransformationStep(
                    id=f"passthrough_to_{out.lower()}",
                    description=f"Pass-through to {out}",
                    type="select",
                    source_inputs=[source_for_orphans] if source_for_orphans else [],
                    logic={"columns": ["*"]},
                    output_alias=out,
                )
            )
            produced.add(out)
        return TransformationConfig(steps=steps)

    def _create_passthrough_transformations(
        self,
        all_inputs: dict,
        all_outputs: dict,
    ) -> TransformationConfig:
        """Create pass-through transformation steps when no COBOL steps found."""
        input_names = list(all_inputs.keys())
        output_names = list(all_outputs.keys())

        if not input_names and not output_names:
            return TransformationConfig(
                steps=[
                    TransformationStep(
                        id="placeholder",
                        description="No inputs/outputs from JCL/PROC; add manually",
                        type="custom",
                        source_inputs=[],
                        logic={"note": "Add JCL/COBOL files or edit config"},
                    )
                ]
            )

        if not input_names:
            input_names = ["(no JCL inputs)"]
        if not output_names:
            output_names = ["(no JCL outputs)"]

        steps: List[TransformationStep] = []

        if len(output_names) == 1 and output_names[0] != "(no JCL outputs)":
            steps.append(
                TransformationStep(
                    id="passthrough",
                    description="Pass-through: all inputs to output",
                    type="select",
                    source_inputs=input_names if input_names[0] != "(no JCL inputs)" else [],
                    logic={"columns": "*"},
                    output_alias=output_names[0],
                )
            )
        else:
            for i, out in enumerate(output_names):
                if out == "(no JCL outputs)":
                    continue
                steps.append(
                    TransformationStep(
                        id=f"step_{i+1}_{out.lower()}",
                        description=f"Pass-through to {out}",
                        type="select",
                        source_inputs=input_names if input_names[0] != "(no JCL inputs)" else [],
                        logic={"columns": "*"},
                        output_alias=out,
                    )
                )
            if not steps:
                steps.append(
                    TransformationStep(
                        id="passthrough",
                        description="Pass-through from mainframe inputs to outputs",
                        type="select",
                        source_inputs=input_names if input_names[0] != "(no JCL inputs)" else [],
                        logic={"columns": "*"},
                    )
                )

        return TransformationConfig(steps=steps)

    def _s3_path(self, dataset: str, base: str) -> str:
        """Convert mainframe dataset name to S3 path."""
        normalized = dataset.replace(".", "/").replace("(", "").replace(")", "")
        base = base.rstrip("/")
        return f"{base}/{normalized}"
