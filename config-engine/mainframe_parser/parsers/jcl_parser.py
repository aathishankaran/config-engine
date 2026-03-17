"""
JCL and PROC parser for extracting input/output datasets.

Parses JCL DD statements and PROC definitions using JCL keywords.
Only data inputs/outputs are included; libraries and intermediate (passed) DDs are excluded.
"""

import re
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from dataclasses import dataclass

from ..keywords import JCL_DD_KEYWORDS, JCL_DISP_INPUT, JCL_DISP_OUTPUT
from ..schema import InputConfig, OutputConfig

# DDs that are never data inputs (libraries, load libs, control files, or intermediate/passed datasets)
JCL_SKIP_DD_ALWAYS = frozenset({
    "SYSIN", "SYSOUT", "SYSPRINT", "SYSDBOUT", "SYSDUMP",
    "JOBLIB", "STEPLIB", "PROCLIB", "JCLLIB",
    # Control/parameter files — not data inputs
    "CTLPARM", "CA11NR", "SYSCTL",
})
# DDs that look like inputs but are intermediate (passed from prior step) — exclude from config inputs
JCL_SKIP_INPUT_INTERMEDIATE = frozenset({
    "ACHINPUT", "SORTIN", "PENDTXN", "RETURNS1", "RETURNS2",
})


@dataclass
class DDStatement:
    """Represents a JCL DD statement."""

    ddname: str
    dsn: Optional[str] = None
    disp: Optional[str] = None
    unit: Optional[str] = None
    space: Optional[str] = None
    dcb: Optional[str] = None
    is_input: bool = False
    is_output: bool = False


class JCLParser:
    """Parse JCL and PROC files to extract dataset definitions."""

    # Matches JCL EXEC statements (step or inline) so they're never treated as DD continuation
    EXEC_LINE_PATTERN = re.compile(r"^//\w*\s+EXEC\s+", re.IGNORECASE)

    DD_PATTERN = re.compile(
        r"//(\w+)\s+DD\s+(.*)",
        re.IGNORECASE | re.MULTILINE,
    )
    DSN_PATTERN = re.compile(
        r"DSN=([^,\)\s]+)|DSNAME=([^,\)\s]+)",
        re.IGNORECASE,
    )
    DISP_PATTERN = re.compile(
        r"DISP=\(?([^,\)]+)(?:,([^,\)]+))?(?:,([^,\)]+))?\)?",
        re.IGNORECASE,
    )
    INPUT_DISPS = JCL_DISP_INPUT
    OUTPUT_DISPS = JCL_DISP_OUTPUT
    RECFM_PATTERN = re.compile(r"RECFM=([FVA]+)", re.IGNORECASE)
    LRECL_PATTERN = re.compile(r"LRECL=(\d+)", re.IGNORECASE)

    # ------------------------------------------------------------------ #
    # JCL EXEC step parser                                                #
    # ------------------------------------------------------------------ #

    _EXEC_STEP_RE = re.compile(
        r"^//(\w+)\s+EXEC\s+(\w+)(.*)",
        re.IGNORECASE,
    )
    _PARAM_KV_RE = re.compile(
        r"(\w+)=['\"]?([^,'\"]+)['\"]?",
        re.IGNORECASE,
    )
    _COND_RE = re.compile(
        r"\bCOND=(\([^)]+\)|\w+)",
        re.IGNORECASE,
    )

    def parse_exec_steps(self, content: str) -> List[dict]:
        """
        Parse all EXEC statements from a JCL file.

        Returns a list of dicts:
            {
              "step":      str,          # e.g. "S10"
              "proc":      str,          # e.g. "GENFMT01"
              "params":    Dict[str,str],# override parameters {name: value}
              "condition": str|None,     # COND= clause, if any
            }

        Handles multi-line EXEC parameter continuations (lines that begin with
        ``//`` followed only by spaces and ``PARAM='VALUE'``).
        """
        steps: List[dict] = []
        lines = content.splitlines()
        i = 0
        # Track IF/ENDIF blocks for conditional step detection
        inside_if_block = False

        while i < len(lines):
            raw = lines[i]
            stripped = raw.strip()

            # Real JCL IF block opener: // IF ... THEN
            if re.match(r"^//\s+IF\b.*\bTHEN\b", stripped, re.IGNORECASE):
                inside_if_block = True
                i += 1
                continue

            # Real JCL ENDIF
            if re.match(r"^//\s+ENDIF\b", stripped, re.IGNORECASE):
                inside_if_block = False
                i += 1
                continue

            # Comment-style IF hint: //* IF S10.RC = 5 THEN  → mark next real steps conditional
            if re.match(r"^//\*\s+IF\b", stripped, re.IGNORECASE):
                inside_if_block = True
                i += 1
                continue

            # Skip pure JCL comments
            if stripped.startswith("//*") or not stripped:
                i += 1
                continue

            # Match EXEC statement
            exec_m = self._EXEC_STEP_RE.match(stripped)
            if not exec_m:
                i += 1
                continue

            step_name = exec_m.group(1).upper()
            proc_name = exec_m.group(2).upper()
            rest_of_line = exec_m.group(3)

            # Extract COND from the same line
            condition: Optional[str] = None
            cond_m = self._COND_RE.search(rest_of_line)
            if cond_m:
                condition = cond_m.group(1)
            elif inside_if_block:
                condition = "conditional"

            # Collect EXEC parameter overrides from continuation lines
            params: Dict[str, str] = {}
            j = i + 1
            while j < len(lines):
                cont = lines[j].strip()
                # Continuation: //   PARAM='VALUE'  (no step name between // and PARAM)
                cont_m = re.match(r"^//\s{2,}(\w+)=['\"]?([^,'\"]+)['\"]?,?$", cont)
                if cont_m:
                    pname = cont_m.group(1).upper()
                    pval = cont_m.group(2).strip("'\"")
                    if pname not in ("COND", "PGM"):
                        params[pname] = pval
                    j += 1
                elif cont.startswith("//*") or not cont:
                    j += 1  # skip comments between EXEC params
                else:
                    break

            steps.append({
                "step": step_name,
                "proc": proc_name,
                "params": params,
                "condition": condition,
            })
            i = j

        return steps

    def parse_file(self, path: Path) -> Tuple[List[InputConfig], List[OutputConfig]]:
        """Parse a JCL or PROC file and return inputs/outputs."""
        content = path.read_text(encoding="utf-8", errors="ignore")
        return self.parse_content(content)

    def parse_content(
        self, content: str
    ) -> Tuple[List[InputConfig], List[OutputConfig]]:
        """Parse JCL/PROC content and extract DD statements."""
        inputs: List[InputConfig] = []
        outputs: List[OutputConfig] = []

        lines = content.splitlines()
        current_dd: Optional[dict] = None

        for line in lines:
            if line.strip().startswith("//") and " DD " in line.upper():
                if current_dd:
                    self._process_dd(current_dd, inputs, outputs)

                match = self.DD_PATTERN.search(line)
                if match:
                    ddname = match.group(1)
                    rest = match.group(2)
                    current_dd = {
                        "ddname": ddname,
                        "params": rest,
                        "full_params": rest,
                    }
            elif current_dd and line.strip() and not line.strip().startswith("/*"):
                # EXEC statements are NOT DD continuations — flush current DD and stop
                if self.EXEC_LINE_PATTERN.match(line.strip()):
                    self._process_dd(current_dd, inputs, outputs)
                    current_dd = None
                else:
                    current_dd["full_params"] += " " + line.strip()

        if current_dd:
            self._process_dd(current_dd, inputs, outputs)

        return inputs, outputs

    def _infer_io_from_ddname(self, ddname: str) -> Optional[str]:
        """Infer input vs output from DD name when DISP is missing or symbolic. Returns 'input', 'output', or None."""
        name = ddname.upper()
        out_marks = ("OUT", "OUTPUT", "SUMMARY", "RPT", "REPORT", "REPORT1", "REPORT2", "WRITE", "DEST", "TARGET")
        in_marks = ("IN", "INPUT", "FILE", "TXN", "TXNIN", "READ", "SOURCE", "DAILY", "COPY", "CNTL", "CTL")
        if any(m in name for m in out_marks):
            return "output"
        if any(m in name for m in in_marks):
            return "input"
        return None

    def _process_dd(
        self,
        dd: dict,
        inputs: List[InputConfig],
        outputs: List[OutputConfig],
    ) -> None:
        """Process a DD statement into InputConfig or OutputConfig."""
        ddname = dd["ddname"]
        params = dd.get("full_params", dd["params"])

        if ddname in JCL_SKIP_DD_ALWAYS:
            return

        dsn_match = self.DSN_PATTERN.search(params)
        dsn = None
        if dsn_match:
            dsn = dsn_match.group(1) or dsn_match.group(2)
            dsn = dsn.strip("'\"()").replace("&&", "&")

        dcb_meta: dict = {}
        recfm = self.RECFM_PATTERN.search(params)
        lrecl = self.LRECL_PATTERN.search(params)
        if recfm:
            dcb_meta["recfm"] = recfm.group(1)
        if lrecl:
            dcb_meta["lrecl"] = int(lrecl.group(1))

        disp_match = self.DISP_PATTERN.search(params)
        status = None
        disp_action = None  # normal disposition: KEEP, DELETE, CATLG, PASS
        if disp_match:
            status = disp_match.group(1).strip().upper()
            if disp_match.group(2):
                disp_action = disp_match.group(2).strip().upper()

        is_input = status in self.INPUT_DISPS
        is_output = status in self.OUTPUT_DISPS

        if not is_input and not is_output:
            if status == "NEW":
                is_output = True
            elif status and not status.startswith("&"):
                is_input = True
            else:
                inferred = self._infer_io_from_ddname(ddname)
                if inferred == "output":
                    is_output = True
                elif inferred == "input":
                    is_input = True
                elif dsn and "DUMMY" not in params.upper():
                    is_input = True

        # Do not treat intermediate/temp datasets as final outputs.
        # DISP=(NEW,PASS,...) means the dataset is passed to the next step (temp); only CATLG/KEEP are final.
        if is_output and disp_action == "PASS":
            return
        # DISP=(MOD,DELETE,...) = temporary work dataset; skip it
        if is_output and status == "MOD" and disp_action == "DELETE":
            return

        # Only include real data inputs; exclude intermediate/passed DDs (e.g. ACHINPUT, SORTIN, PENDTXN).
        if is_input and ddname in JCL_SKIP_INPUT_INTERMEDIATE:
            return

        meta = {"dd_statement": dd.get("full_params", params)}
        if dcb_meta:
            meta["dcb"] = dcb_meta

        if is_input:
            inputs.append(
                InputConfig(
                    name=ddname,
                    dataset=dsn,
                    format="fixed",
                    metadata=meta,
                )
            )
        elif is_output:
            outputs.append(
                OutputConfig(
                    name=ddname,
                    dataset=dsn,
                    format="parquet",
                    write_mode="overwrite",
                    metadata=meta,
                )
            )
