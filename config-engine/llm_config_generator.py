"""
LLM-based config generator for mainframe-to-PySpark migration.

Sends COBOL, JCL, and copybook source code to an LLM and returns a dataflow
config JSON matching the project schema.

Supports:
- Anthropic Claude API (auto-detected from ANTHROPIC_API_KEY or api.anthropic.com URL)
- OpenAI API (set llm_base_url="" and OPENAI_API_KEY env var)
- Ollama / local models (set llm_base_url="http://localhost:11434/v1")
- Any OpenAI-compatible endpoint (Azure, vLLM, LiteLLM, etc.)
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

LOG = logging.getLogger("llm_config_generator")

# ---------------------------------------------------------------------------
# System prompt: describes the exact JSON schema the LLM must produce
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a mainframe migration expert. You convert COBOL programs, JCL jobs, \
and copybook definitions into a PySpark dataflow configuration JSON that is \
consumed directly by the DataFlowRunner engine.

You MUST return ONLY valid JSON — no markdown fences, no commentary, no explanation.

The JSON must have this exact top-level structure:
{
  "Inputs": { "<CONFIG-NAME>-INPUT-01": { ... } },
  "Outputs": { "<CONFIG-NAME>-OUTPUT-01": { ... } },
  "Transformations": { "description": "...", "steps": [...] }
}

=== INPUTS ===

Each key is a unique input name using the config name as prefix (e.g. "MY-CONFIG-INPUT-01").
The engine reads each input via DataFlowRunner._read_input() which uses these fields:

REQUIRED fields for every input:
- "name": same as the key
- "format": "FIXED" (fixed-width positional), "DELIMITED" (CSV/delimited), or "PARQUET"
- "dataset_name": physical filename from JCL DD DSN last qualifier + ".DAT" (e.g. "BANK-INPUT-TXN.DAT")
- "source_file_name": same as dataset_name
- "frequency": "DAILY" (default for batch jobs), "WEEKLY", or "MONTHLY"
- "header_count": integer 0 or 1 — number of header lines to skip when reading data
- "trailer_count": integer 0 or 1 — number of trailer lines to skip at end
- "record_length": integer — total byte width of one data record (sum of all DATA field lengths)
- "header_fields": array of field objects for HEADER record ([] if header_count=0)
- "fields": array of field objects for DATA record — THIS IS THE MAIN DATA SCHEMA
- "trailer_fields": array of field objects for TRAILER record ([] if trailer_count=0)
- "prev_day_check": {"enabled": false, "header_date_field": ""}

=== FIELD OBJECTS (for FIXED format) ===

Input DATA fields (in "fields" array) — MUST have ALL of:
- "name": COBOL field name with hyphens preserved (e.g. "TXN-ID", "TXN-AMOUNT")
- "type": one of "STRING", "LONG", "DOUBLE", "DECIMAL", "DATE", "INT"
- "start": 1-based byte position within this record group (first field starts at 1)
- "length": field byte width (from COBOL PIC clause)
- "nullable": true

For DATE fields, also add:
- "format": Spark date format string (e.g. "yyyyMMdd", "yyyy-MM-dd")

For DECIMAL fields (PIC 9(n)V9(m)), also add:
- "precision": number of decimal places (the m in V9(m))

Input HEADER/TRAILER fields follow the same schema (name, type, start, length, nullable).

Output HEADER/TRAILER fields are simpler — only need: "name", "type", "length"
(no "start" needed — the engine builds output rows sequentially).

=== COBOL PIC TO TYPE MAPPING ===
- PIC X(n)           → type: "STRING",  length: n
- PIC 9(n)           → type: "LONG",    length: n  (if n <= 18)
- PIC 9(n)V9(m)      → type: "DOUBLE",  length: n+m  (use "DECIMAL" with "precision": m if exact math needed)
- PIC S9(n) COMP-3   → type: "DECIMAL", length: ceil((n+1)/2), "precision": 0
- PIC 9(8) date      → type: "DATE",    length: 8, "format": "yyyyMMdd"
- PIC 9(2)           → type: "INT",     length: 2  (for small counts/codes)

Supported engine type strings (case-insensitive): string, str, int, integer, long, bigint, \
double, float, decimal, number, date, timestamp, boolean, bool, binary, bytes.

=== COPYBOOK RECORD-TYPE CLASSIFICATION ===

This is CRITICAL — count the 01-level groups in each INDIVIDUAL copybook file:
- ONE 01-level group → ALL fields are DATA. header_count=0, trailer_count=0, header_fields=[], trailer_fields=[].
- TWO 01-level groups → first=HEADER, second=DATA. header_count=1, trailer_count=0.
- THREE 01-level groups → HEADER / DATA / TRAILER. header_count=1, trailer_count=1.

IMPORTANT:
- Separate copybook FILES are always independent — each gets its own classification.
- Calculate "start" positions within each record group independently (each starts at 1).
- record_length = sum of DATA field lengths only (not header or trailer).

=== OUTPUTS ===

Each key is a unique output name (e.g. "MY-CONFIG-OUTPUT-01").
The engine writes each output via DataFlowRunner._write_output() which uses these fields:

REQUIRED fields for every output:
- "name": same as the key
- "format": "FIXED", "DELIMITED", or "PARQUET"
- "dataset_name": output filename (e.g. "BANK-OUTPUT-SUMMARY.DAT")
- "source_file_name": same as dataset_name
- "frequency": "DAILY"
- "write_mode": "OVERWRITE" (or "APPEND")
- "source_inputs": array — MUST list the output_alias of the LAST transformation step that feeds this output
- "header_count": 0 or 1
- "trailer_count": 0 or 1
- "ctrl_file_gen": true if a control/count file should be generated, else false
- "record_length": total byte width of output data record
- "fields": array of field objects for DATA record (from output copybook)
- "output_columns": array of DATA field names in order — controls which columns are written
- "header_fields": array of header field objects (each with "name", "type", "length" — no "start")
- "trailer_fields": array of trailer field objects (each with "name", "type", "length" — no "start")

The engine resolves the output DataFrame by looking up source_inputs in its dataset registry. \
The pipeline chain MUST be: Input name → validate output_alias → step output_alias → ... → Output source_inputs.

=== TRANSFORMATIONS ===

"steps" is an ordered array. Each step MUST have:
- "id": unique step ID (e.g. "MY-CONFIG-DATA-VALIDATION-01")
- "description": brief description
- "type": "validate", "filter", "aggregate", "select", "join", "union", or "custom"
- "source_inputs": [<name-of-input-node-or-previous-step-output_alias>]
- "output_alias": result name for downstream steps (e.g. "MY-CONFIG-DATA-VALIDATION-OUT-01")
- "logic": type-specific object (see below)

The engine executes steps in array order. Each step reads from source_inputs in the dataset \
registry and stores its result under output_alias.

--- validate step logic ---
{
  "fail_mode": "ABORT",
  "rules": [
    {"field": "FIELD-NAME", "data_type": "TEXT", "nullable": true, "max_length": 10, "format": "ANY"}
  ],
  "dataset_name": "CONFIGVAL.DAT",
  "error_dataset_name": "CONFIGERR.DAT",
  "frequency": "DAILY",
  "validated_path": "",
  "error_path": "",
  "previous_day_check": false,
  "previous_day_header_date_field": "",
  "record_count_check": false,
  "record_count_trailer_field": "",
  "ctrl_file_create": false,
  "ctrl_file_name": "",
  "ctrl_include_header": false,
  "ctrl_file_fields": []
}

Generate ONE rule per DATA field from the source input's "fields" array:
- data_type: "TEXT" for STRING, "NUMBER" for LONG/DOUBLE/DECIMAL/INT, "DATE" for DATE
- max_length: same as the field's "length"
- nullable: true (default)
- format: "DATE" for DATE fields, "ANY" for everything else
- field: use the EXACT field name from the input (with hyphens)

fail_mode values: "ABORT" (raise error), "FLAG" (add _is_valid column), "DROP" (remove invalid rows)

--- filter step logic ---
{
  "conditions": [
    {"field": "TXN-AMOUNT", "operation": ">", "value": 1000}
  ]
}
Supported operations: "==" (or "eq"), "!=" (or "ne"), ">" (or "gt"), "<" (or "lt"), \
">=" (or "ge"), "<=" (or "le"), "in" (or "in_list"), "not_in" (or "not_in_list")
The value can be a number, string, or array (for in/not_in).

--- aggregate step logic ---
{
  "group_by": ["CUST-ID"],
  "aggregations": [
    {"field": "TXN-AMOUNT", "operation": "sum", "alias": "SUM-TOTAL-AMT"},
    {"field": "*", "operation": "count", "alias": "SUM-TXN-COUNT"}
  ]
}
Supported operations: "sum" (or "add"), "count" (or "tallying"), "avg", "min", "max"
If group_by is empty [], the aggregation is global (all rows → one result row).
For count of all rows, use field "*".

--- select step logic ---
{
  "expressions": [
    {"target": "OUT-FIELD", "expression": "INP-FIELD", "operation": "move"},
    {"target": "WS-TOTAL", "expression": "AMOUNT", "operation": "add"},
    {"target": "RESULT", "expression": "A * B", "operation": "compute"}
  ]
}
Operations: "move" (copy), "add" (accumulate), "subtract", "multiply", "divide", \
"compute" (Spark SQL expression), "initialize" (set literal via "value" key), \
"string" (concat), "unstring" (split), "inspect" (regex replace)

--- join step logic ---
{
  "left": "LEFT-ALIAS",
  "right": "RIGHT-ALIAS",
  "on": [["LEFT-COL", "RIGHT-COL"]],
  "how": "inner"
}

--- custom step logic ---
{
  "operation": "sort",
  "key": ["FIELD1"],
  "ascending": true
}

=== COBOL PROGRAM ANALYSIS ===

When COBOL programs (.cbl) and PROC files are provided, analyze them to build the transformation pipeline:

1. COPY statement in FD sections → determines which copybook maps to which I/O:
   "FD INFILE. COPY TRANSACTION." → input uses TRANSACTION.cpy fields
   "FD OUTFILE. COPY SUMMARY." → output uses SUMMARY.cpy fields

2. IF condition + WRITE → filter step:
   "IF TXN-AMOUNT > 1000 WRITE TXN-REC" →
   type: "filter", conditions: [{"field": "TXN-AMOUNT", "operation": ">", "value": 1000}]

3. ADD/COMPUTE with accumulators → aggregate step:
   "ADD TXN-AMOUNT TO WS-TOTAL" + "ADD 1 TO WS-COUNT" →
   type: "aggregate", group_by: [], aggregations: [
     {"field": "TXN-AMOUNT", "operation": "sum", "alias": "SUM-TOTAL-AMT"},
     {"field": "*", "operation": "count", "alias": "SUM-TXN-COUNT"}
   ]
   Map the aggregate aliases to the OUTPUT copybook field names.

4. MOVE field TO field → select step:
   "MOVE INP-FIELD TO OUT-FIELD" →
   type: "select", expressions: [{"target": "OUT-FIELD", "expression": "INP-FIELD", "operation": "move"}]

5. Multiple programs in PROC → ordered pipeline:
   STEP1 EXEC PGM=PROG1, STEP2 EXEC PGM=PROG2 →
   Steps in order: validate → PROG1 logic → PROG2 logic
   Chain: each step's output_alias → next step's source_inputs

6. Intermediate WORK datasets (BANK.WORK.*) are internal — NOT config I/O nodes.
   Only the FIRST input DSN and LAST output DSN become config Inputs/Outputs.

=== RULES ===
1. Keep COBOL field names with hyphens — do NOT convert to underscores.
2. Calculate start positions per record group: first field start=1, next=prev_start+prev_length.
3. JCL DD with DISP=SHR or DISP=OLD → input node. DD with DISP=(NEW,CATLG) → output node.
4. ALWAYS generate a validate step as the first transformation step for each input.
5. Connect output source_inputs to the LAST step's output_alias in the pipeline chain.
6. dataset_name: take last DSN qualifier, replace dots with hyphens, add ".DAT".
7. Aggregate alias names MUST match the output copybook field names for the engine to map them.
8. Filter "value" for numeric comparisons should be a number (not string): 1000 not "1000".
9. If no COBOL programs are provided, generate only: validate step (no filter/aggregate/select).
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> Optional[dict]:
    """Extract JSON from LLM response, handling markdown fences and extra text."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strip markdown code fences
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Find first { ... last }
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        try:
            return json.loads(text[first : last + 1])
        except json.JSONDecodeError:
            pass

    return None


def _validate_config_structure(config: dict) -> bool:
    """Basic structural validation of the generated config."""
    if not isinstance(config, dict):
        return False
    has_inputs = "Inputs" in config and isinstance(config["Inputs"], dict)
    has_outputs = "Outputs" in config and isinstance(config["Outputs"], dict)
    if not has_inputs and not has_outputs:
        return False
    if "Transformations" in config:
        t = config["Transformations"]
        if not isinstance(t, dict):
            return False
        if "steps" in t and not isinstance(t["steps"], list):
            return False
    else:
        config["Transformations"] = {"description": "", "steps": []}
    return True


def _is_anthropic(base_url: str, api_key: str) -> bool:
    """Detect if we should use the Anthropic Messages API."""
    if "anthropic.com" in base_url:
        return True
    if api_key and not base_url:
        return True
    return False


def _call_anthropic(
    system: str,
    user_message: str,
    base_url: str,
    model: str,
    api_key: str,
    timeout_seconds: int,
) -> str:
    """Call the Anthropic Messages API."""
    import urllib.request
    import urllib.error

    url = base_url.rstrip("/") + "/v1/messages"
    body = {
        "model": model,
        "max_tokens": 16000,
        "temperature": 0.1,
        "system": system,
        "messages": [{"role": "user", "content": user_message}],
    }
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            content = result.get("content", [])
            texts = [c["text"] for c in content if c.get("type") == "text"]
            return "\n".join(texts)
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        raise RuntimeError(
            f"Anthropic API returned HTTP {e.code}: {body_text}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Cannot reach Anthropic API at {url}: {e.reason}"
        ) from e


def _call_openai_compatible(
    messages: List[Dict[str, str]],
    base_url: str,
    model: str,
    api_key: str,
    timeout_seconds: int,
) -> str:
    """Call an OpenAI-compatible chat completions endpoint."""
    import urllib.request
    import urllib.error

    url = base_url.rstrip("/") + "/chat/completions"
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 16000,
    }
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        raise RuntimeError(
            f"LLM API returned HTTP {e.code}: {body_text}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Cannot reach LLM API at {url}: {e.reason}"
        ) from e


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_config_with_llm(
    jcl_content: str = "",
    cobol_content: str = "",
    copybook_content: str = "",
    base_s3_path: str = "",
    llm_api_key: str = "",
    llm_base_url: str = "",
    llm_model: str = "",
    timeout_seconds: int = 600,
    log_sink: Optional[List[str]] = None,
    config_name: str = "",
) -> Optional[Dict[str, Any]]:
    """
    Generate a dataflow config JSON by sending mainframe source to an LLM.

    Parameters
    ----------
    jcl_content : str
        Concatenated JCL/PROC file contents.
    cobol_content : str
        Concatenated COBOL program contents.
    copybook_content : str
        Concatenated copybook file contents.
    base_s3_path : str
        Base S3 path prefix for inputs/outputs.
    llm_api_key : str
        API key from settings (sk-ant-... for Anthropic, sk-... for OpenAI).
    llm_base_url : str
        API base URL. Auto-detects provider.
    llm_model : str
        Model identifier (e.g. "claude-opus-4-20250514", "gpt-4o-mini").
    timeout_seconds : int
        HTTP request timeout.
    log_sink : list or None
        Append log messages here for UI display.
    config_name : str
        Config/interface name used as prefix for node names.

    Returns
    -------
    dict or None
        Config dict with Inputs/Outputs/Transformations, or None on failure.
    """
    def _log(msg: str):
        LOG.info(msg)
        if log_sink is not None:
            log_sink.append(msg)

    # Resolve API key — settings key first, then env vars
    anthropic_key = ""
    openai_key = ""
    if llm_api_key:
        if llm_api_key.startswith("sk-ant-"):
            anthropic_key = llm_api_key
        else:
            openai_key = llm_api_key
    if not anthropic_key:
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not openai_key:
        openai_key = os.environ.get("OPENAI_API_KEY", "") or os.environ.get("LLM_API_KEY", "")

    # Determine provider
    use_anthropic = False
    api_key = ""

    if not llm_base_url:
        if anthropic_key:
            use_anthropic = True
            api_key = anthropic_key
            llm_base_url = "https://api.anthropic.com"
            if not llm_model:
                llm_model = "claude-opus-4-20250514"
        elif openai_key:
            api_key = openai_key
            llm_base_url = "https://api.openai.com/v1"
            if not llm_model:
                llm_model = "gpt-4o-mini"
        else:
            _log("ERROR: No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")
            return None
    elif "anthropic.com" in llm_base_url:
        use_anthropic = True
        api_key = anthropic_key or openai_key
        if not llm_model:
            llm_model = "claude-opus-4-20250514"
    else:
        api_key = openai_key or anthropic_key
        if not llm_model:
            llm_model = "gpt-4o-mini"

    is_local = "localhost" in llm_base_url or "127.0.0.1" in llm_base_url
    if not api_key and not is_local:
        _log("WARNING: No API key environment variable set.")

    # Build user prompt with all source code
    parts = []
    if jcl_content.strip():
        parts.append(f"## JCL / PROC\n```\n{jcl_content.strip()}\n```")
    if cobol_content.strip():
        parts.append(f"## COBOL Program\n```\n{cobol_content.strip()}\n```")
    if copybook_content.strip():
        parts.append(f"## Copybooks\n```\n{copybook_content.strip()}\n```")

    if not parts:
        _log("No mainframe source code provided to LLM.")
        return None

    user_prompt = (
        "Analyze the following mainframe source code and generate the dataflow "
        "configuration JSON. Return ONLY the JSON, no other text.\n\n"
        "IMPORTANT: If COBOL programs are provided, extract transformation logic "
        "from their PROCEDURE DIVISION. Map IF conditions to filter steps, "
        "ADD/COMPUTE to aggregate steps, MOVE to select steps. "
        "Generate steps in PROC execution order.\n\n"
        + "\n\n".join(parts)
    )

    if config_name:
        user_prompt += (
            f"\n\nUse \"{config_name}\" as the prefix for all node names "
            f"(e.g. \"{config_name}-INPUT-01\", \"{config_name}-OUTPUT-01\", "
            f"\"{config_name}-DATA-VALIDATION-01\")."
        )

    if base_s3_path:
        user_prompt += (
            f"\n\nUse this base path for source_path fields: {base_s3_path}"
        )

    provider_name = "Anthropic Claude" if use_anthropic else "OpenAI-compatible"
    _log(f"Calling {provider_name}: model={llm_model}, endpoint={llm_base_url}")

    try:
        if use_anthropic:
            response_text = _call_anthropic(
                system=SYSTEM_PROMPT,
                user_message=user_prompt,
                base_url=llm_base_url,
                model=llm_model,
                api_key=api_key,
                timeout_seconds=timeout_seconds,
            )
        else:
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ]
            response_text = _call_openai_compatible(
                messages=messages,
                base_url=llm_base_url,
                model=llm_model,
                api_key=api_key,
                timeout_seconds=timeout_seconds,
            )
    except Exception as e:
        _log(f"LLM API call failed: {e}")
        return None

    _log(f"LLM response received ({len(response_text)} chars). Parsing JSON...")

    config = _extract_json(response_text)
    if config is None:
        _log("Failed to parse JSON from LLM response.")
        LOG.debug("Raw LLM response: %s", response_text[:2000])
        return None

    if not _validate_config_structure(config):
        _log("LLM returned JSON but it doesn't match the expected config structure.")
        return None

    # Post-process: ensure all inputs/outputs have required fields
    _post_process_config(config, config_name=config_name, base_s3_path=base_s3_path)

    _log(
        f"LLM config generated: "
        f"{len(config.get('Inputs', {}))} inputs, "
        f"{len(config.get('Outputs', {}))} outputs, "
        f"{len(config.get('Transformations', {}).get('steps', []))} transformation steps."
    )

    return config


# ---------------------------------------------------------------------------
# Post-processing: fill derived fields the LLM may omit
# ---------------------------------------------------------------------------

def _calc_record_length(fields: List[dict]) -> int:
    """Calculate record length from field start + length values."""
    if not fields:
        return 0
    max_end = 0
    for f in fields:
        s = f.get("start", 0)
        l = f.get("length", 0)
        if s and l:
            end = s + l - 1
            if end > max_end:
                max_end = end
    return max_end


def _derive_dataset_name(node_name: str, existing: dict) -> str:
    """Derive dataset_name from node name or existing fields."""
    # Check if already set
    for key in ("dataset_name", "dataset", "dsn"):
        val = existing.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    # Derive from name — strip common suffixes like INPUT-01, OUTPUT-01
    base = node_name
    for suffix in ("-INPUT-01", "-INPUT-02", "-OUTPUT-01", "-OUTPUT-02",
                    "-EFS-OUTPUT-01", "-EFS-OUTPUT-02"):
        if base.upper().endswith(suffix):
            base = base[: -len(suffix)]
            break
    return base + ".DAT"


def _post_process_config(
    config: dict,
    config_name: str = "",
    base_s3_path: str = "",
) -> None:
    """Ensure generated config has all fields expected by the dataflow engine and UI.

    The DataFlowRunner consumes these fields at runtime:
      Input:  format, fields (name/type/start/length/nullable/format/precision),
              header_count, trailer_count, header_fields, trailer_fields,
              record_length, dataset_name, source_file_name, frequency,
              prev_day_check, delimiter_char (for DELIMITED)
      Output: format, fields, output_columns, header_count, trailer_count,
              header_fields, trailer_fields, record_length, write_mode,
              source_inputs, dataset_name, source_file_name, frequency,
              ctrl_file_gen, control_file_path, control_fields
      Validate step logic: fail_mode, rules, dataset_name, error_dataset_name,
              frequency, validated_path, error_path, previous_day_check,
              previous_day_header_date_field, record_count_check,
              record_count_trailer_field, ctrl_file_create, ctrl_file_name,
              ctrl_include_header, ctrl_file_fields
    """
    cn = config_name or "IMPORTED"

    # --- Inputs ---
    for key, inp in config.get("Inputs", {}).items():
        inp.setdefault("name", key)
        inp.setdefault("format", "FIXED")
        inp.setdefault("fields", [])
        inp.setdefault("header_fields", [])
        inp.setdefault("trailer_fields", [])
        inp.setdefault("header_count", 1 if inp["header_fields"] else 0)
        inp.setdefault("trailer_count", 1 if inp["trailer_fields"] else 0)

        # Safety net: if LLM misclassified single-copybook as HEADER/TRAILER
        if inp["header_fields"] and not inp["fields"]:
            inp["fields"] = inp["header_fields"]
            inp["header_fields"] = []
            inp["header_count"] = 0
        if inp["trailer_fields"] and not inp["fields"]:
            inp["fields"] = inp["trailer_fields"]
            inp["trailer_fields"] = []
            inp["trailer_count"] = 0

        # Derived fields
        dsn = _derive_dataset_name(key, inp)
        inp.setdefault("dataset_name", dsn)
        inp.setdefault("source_file_name", inp["dataset_name"])
        inp.setdefault("frequency", "DAILY")
        if base_s3_path and "source_path" not in inp:
            inp["source_path"] = base_s3_path.rstrip("/") + f"/raw/{cn}/"
        inp.setdefault("prev_day_check", {"enabled": False, "header_date_field": ""})

        # Record length — computed from DATA fields
        rl = _calc_record_length(inp["fields"])
        if rl <= 0:
            # Fallback: sum of all field lengths
            rl = sum(int(f.get("length") or 0) for f in inp["fields"])
        if rl > 0:
            inp.setdefault("record_length", rl)

        # Ensure field start positions are correct (auto-compute if missing)
        _fix_field_starts(inp["fields"])
        _fix_field_starts(inp["header_fields"])
        _fix_field_starts(inp["trailer_fields"])

        # Ensure field objects have required keys
        for field_list in [inp["fields"], inp["header_fields"], inp["trailer_fields"]]:
            for f in field_list:
                f.setdefault("type", "STRING")
                f.setdefault("nullable", True)
                if not f.get("length"):
                    f["length"] = 1

    # --- Outputs ---
    for key, out in config.get("Outputs", {}).items():
        out.setdefault("name", key)
        out.setdefault("format", "FIXED")
        out.setdefault("write_mode", "OVERWRITE")
        out.setdefault("fields", [])
        out.setdefault("header_fields", [])
        out.setdefault("trailer_fields", [])
        out.setdefault("header_count", 1 if out["header_fields"] else 0)
        out.setdefault("trailer_count", 1 if out["trailer_fields"] else 0)
        out.setdefault("source_inputs", [])
        out.setdefault("ctrl_file_gen", False)

        # Safety net: if LLM misclassified single-copybook as HEADER/TRAILER
        if out["header_fields"] and not out["fields"]:
            out["fields"] = out["header_fields"]
            out["header_fields"] = []
            out["header_count"] = 0
        if out["trailer_fields"] and not out["fields"]:
            out["fields"] = out["trailer_fields"]
            out["trailer_fields"] = []
            out["trailer_count"] = 0

        # Derived fields
        dsn = _derive_dataset_name(key, out)
        out.setdefault("dataset_name", dsn)
        out.setdefault("source_file_name", out["dataset_name"])
        out.setdefault("frequency", "DAILY")
        if base_s3_path and "source_path" not in out:
            out["source_path"] = base_s3_path.rstrip("/") + f"/curated/{cn}/"

        # Record length
        rl = _calc_record_length(out["fields"])
        if rl <= 0:
            rl = sum(int(f.get("length") or 0) for f in out["fields"])
        if rl > 0:
            out.setdefault("record_length", rl)

        # Fix field start positions
        _fix_field_starts(out["fields"])

        # Build output_columns from data fields if missing
        if "output_columns" not in out and out["fields"]:
            out["output_columns"] = [f["name"] for f in out["fields"] if f.get("name")]

        for field_list in [out["fields"], out["header_fields"], out["trailer_fields"]]:
            for f in field_list:
                f.setdefault("type", "STRING")
                f.setdefault("nullable", True)
                if not f.get("length"):
                    f["length"] = 1

    # --- Transformations ---
    config.setdefault("Transformations", {"description": "", "steps": []})
    t = config["Transformations"]
    t.setdefault("description", "Generated by LLM")
    t.setdefault("steps", [])

    # Build a lookup: input key → input config (for deriving validate step fields)
    inputs_map = config.get("Inputs", {})

    for step in t["steps"]:
        step.setdefault("id", "step-01")
        step.setdefault("description", "")
        step.setdefault("type", "select")
        step.setdefault("source_inputs", [])
        step.setdefault("output_alias", step["id"] + "-OUT")
        step.setdefault("logic", {})

        # Enrich validate steps
        if step.get("type") == "validate":
            logic = step["logic"]
            logic.setdefault("fail_mode", "ABORT")
            logic.setdefault("rules", [])
            logic.setdefault("frequency", "DAILY")

            # Derive dataset names from source input
            src_inputs = step.get("source_inputs", [])
            src_input_cfg = None
            if src_inputs:
                src_input_cfg = inputs_map.get(src_inputs[0])

            if src_input_cfg and "dataset_name" not in logic:
                src_dsn = src_input_cfg.get("dataset_name", "")
                stem = Path(src_dsn).stem if src_dsn else ""
                ext = Path(src_dsn).suffix if src_dsn else ".DAT"
                logic.setdefault("dataset_name", f"{stem}VAL{ext}" if stem else "")
                logic.setdefault("error_dataset_name", f"{stem}ERR{ext}" if stem else "")
            else:
                logic.setdefault("dataset_name", "")
                logic.setdefault("error_dataset_name", "")

            # Auto-generate rules from source input fields if LLM omitted them
            if not logic["rules"] and src_input_cfg:
                logic["rules"] = _generate_validate_rules(src_input_cfg.get("fields") or [])

            # Derived paths
            if base_s3_path:
                logic.setdefault("validated_path", base_s3_path.rstrip("/") + f"/validated/{cn}/")
                logic.setdefault("error_path", base_s3_path.rstrip("/") + f"/error/{cn}/")
            else:
                logic.setdefault("validated_path", "")
                logic.setdefault("error_path", "")

            # Default checks off
            logic.setdefault("previous_day_check", False)
            logic.setdefault("previous_day_header_date_field", "")
            logic.setdefault("record_count_check", False)
            logic.setdefault("record_count_trailer_field", "")
            logic.setdefault("ctrl_file_create", False)
            logic.setdefault("ctrl_file_name", "")
            logic.setdefault("ctrl_include_header", False)
            logic.setdefault("ctrl_file_fields", [])

        elif step.get("type") == "filter":
            logic = step["logic"]
            logic.setdefault("conditions", [])
            # Coerce string numeric values to actual numbers for the engine
            for cond in logic.get("conditions", []):
                val = cond.get("value")
                if isinstance(val, str):
                    try:
                        cond["value"] = int(val)
                    except ValueError:
                        try:
                            cond["value"] = float(val)
                        except ValueError:
                            pass

        elif step.get("type") == "aggregate":
            logic = step["logic"]
            logic.setdefault("group_by", [])
            logic.setdefault("aggregations", [])

        elif step.get("type") == "select":
            logic = step["logic"]
            logic.setdefault("expressions", [])

        elif step.get("type") == "join":
            logic = step["logic"]
            logic.setdefault("on", [])
            logic.setdefault("how", "inner")

        elif step.get("type") == "custom":
            logic = step["logic"]
            logic.setdefault("operation", "sort")

    # Wire unconnected outputs to the last transformation step
    all_steps = t["steps"]
    if all_steps:
        last_alias = all_steps[-1].get("output_alias", "")
        if last_alias:
            for key, out in config.get("Outputs", {}).items():
                if not out.get("source_inputs"):
                    out["source_inputs"] = [last_alias]


def _fix_field_starts(fields: List[dict]) -> None:
    """Auto-compute sequential start positions when missing or all zero."""
    if not fields:
        return
    # Check if starts are already set
    has_start = any(int(f.get("start") or 0) > 0 for f in fields)
    if has_start:
        return
    # Auto-assign sequential starts
    pos = 1
    for f in fields:
        f["start"] = pos
        pos += int(f.get("length") or 1)


def _generate_validate_rules(fields: List[dict]) -> List[dict]:
    """Generate validation rules from input field definitions."""
    rules = []
    for f in fields:
        name = f.get("name", "")
        if not name:
            continue
        ftype = (f.get("type") or "STRING").upper()
        length = int(f.get("length") or 0)
        if ftype in ("LONG", "DOUBLE", "DECIMAL", "INT", "INTEGER", "FLOAT", "NUMBER"):
            data_type = "NUMBER"
        elif ftype in ("DATE", "TIMESTAMP"):
            data_type = "DATE"
        else:
            data_type = "TEXT"
        rule = {
            "field": name,
            "data_type": data_type,
            "nullable": True,
            "max_length": length if length > 0 else 255,
            "format": "DATE" if data_type == "DATE" else "ANY",
        }
        rules.append(rule)
    return rules
