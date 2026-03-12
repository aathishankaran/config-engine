# Config Engine - Developer Guide

## Architecture
Flask web application (port 5000) that provides:
1. REST API for managing dataflow configuration JSON files
2. Mainframe artifact parser pipeline (JCL -> COBOL -> Copybook -> Config JSON)
3. Dataflow Studio UI for visual config editing
4. Test runner that invokes dataflow-engine as subprocess

## Project Structure
```
config-engine/
├── app.py                              # Flask REST API (main application)
├── requirements.txt                    # Python 3.6.8+ dependencies
├── configs/                            # Default config JSON storage
├── static/                             # Frontend assets (HTML/CSS/JS)
├── mainframe_parser/
│   ├── __init__.py                     # Package exports
│   ├── keywords.py                     # COBOL/JCL keyword mappings
│   ├── schema.py                       # Pydantic v1 data models
│   ├── engine.py                       # MainframeConfigEngine orchestrator
│   ├── file_discovery.py               # File scanner by extension
│   └── parsers/
│       ├── __init__.py                 # Parser exports
│       ├── jcl_parser.py               # JCL/PROC parser
│       ├── cobol_parser.py             # COBOL source parser
│       ├── copybook_parser.py          # Copybook field schema extractor
│       └── cobol_transformation_extractor.py  # Rule-based COBOL→PySpark transforms
└── util/
    ├── test_dataflow.py                # Test runner (PySpark subprocess)
    └── zip_import.py                   # ZIP import pipeline
```

## Module Reference

### app.py — Flask REST API
Main application file with 24 routes.

**Configuration:**
- CONFIG_DIR: directory for config JSON files (env: CONFIG_DIR)
- SETTINGS_PATH: application settings JSON
- DEFAULT_SETTINGS: dict with use_llm, path prefixes, LLM config, usa_holidays

**Helper Functions:**
- `_load_settings() -> dict` — Load settings from file, return defaults if missing
- `_save_settings(data: dict) -> None` — Merge and save settings
- `_get_config_dir() -> Path` — Get effective config directory from settings or env
- `_config_path(relative: str) -> Path` — Resolve path under config dir, prevent traversal
- `_parse_fixed_width_text(text, fields, header_count=0, trailer_count=0) -> list` — Parse fixed-width text into row dicts. Auto-normalizes positions for multi-record copybooks.
- `_safe_json_dump(obj, f, indent=2)` — JSON dump that converts sets to lists
- `_find_json_files(dir_path, base="") -> List[dict]` — Recursively find .json files, skip test_data dir
- `_parse_ctrl_file_text(text, ctrl_file_fields, ctrl_include_header=False) -> list` — Parse control file text using field definitions
- `_search_in_obj(obj, query, path, results)` — Recursive search helper
- `_safe_config_filename(name: str) -> str` — Sanitize filename
- `_test_data_dir(config_filename: str) -> Path` — Get test data directory for a config

**Routes:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | / | Serve index.html |
| GET | /studio | Serve Dataflow Studio |
| GET | /runbook | Serve user runbook |
| GET | /api/settings | Get application settings |
| PUT | /api/settings | Update settings |
| GET | /api/configs | List all config files |
| GET | /api/config/<path> | Get one config JSON |
| GET | /api/config/<path>/test-data | Get test data for config (auto re-parses FIXED data) |
| PUT | /api/config/<path> | Save/create config JSON |
| DELETE | /api/config/<path> | Delete config and its test data |
| POST | /api/config/<path>/rename | Rename config file |
| GET | /api/search?q=<query> | Search across all configs |
| POST | /api/import-files | Import mainframe files (JCL/COBOL/Copybook) |
| POST | /api/import-zip | Import ZIP archive of mainframe artifacts |
| POST | /api/test/generate-sample | Generate sample test data |
| POST | /api/test/run | Run dataflow test (blocking) |
| POST | /api/test/run-stream | Run dataflow test (SSE streaming) |
| GET | /api/config/<path>/download | Download config JSON |
| POST | /api/parse-copybook | Parse copybook file content |
| POST | /api/config/<path>/node-test-file | Save node test data file |
| POST | /api/config/<path>/last-run-file | Save last run date file |
| POST | /api/config/<path>/rename-node-test-data | Rename test data keys |
| POST | /api/config/<path>/node-copybook | Save node copybook file |

### mainframe_parser/schema.py — Data Models (Pydantic v1)
All models use Pydantic v1 BaseModel with `.dict()` API.

**Classes:**
- `FieldDefinition` — Single field schema
  - name: str, type: str (default "string"), start: Optional[int], length: Optional[int], precision: Optional[int], nullable: bool, format: Optional[str], source: Optional[str], record_type: str ("DATA"|"HEADER"|"TRAILER"), just_right: bool
- `CobrixOptions` — Cobrix EBCDIC reader config
  - copybook_path, encoding ("cp037"), record_format ("F"), file_start_offset, file_end_offset, generate_record_id
- `InputConfig` — Input source config
  - name, dataset, format ("cobol"), copybook, cobrix, fields, s3_path, metadata
- `OutputConfig` — Output destination config
  - name, dataset, format ("parquet"), copybook, fields, header_fields, trailer_fields, output_columns, s3_path, write_mode, metadata
- `TransformationStep` — Single transform step
  - id, description, type ("select"), source_inputs, logic, output_alias
- `TransformationConfig` — Contains list of steps
- `DataFlowConfig` — Top-level config
  - name, description, inputs (Dict[str, InputConfig]), outputs (Dict[str, OutputConfig]), transformations
  - `to_json_config() -> Dict` — Export canonical JSON (excludes cobrix block)

### mainframe_parser/engine.py — Config Generator
**Standalone functions:**
- `_normalize_copybook_stem(stem) -> str` — Strip macOS ._prefix
- `_filter_procs_for_cobol(proc_paths, cobol_paths) -> List[Path]` — Keep only PROCs that execute our COBOL programs

**Class: MainframeConfigEngine**
- `__init__()` — Creates JCLParser, CopybookParser, COBOLParser instances
- `generate_config(jcl_paths, proc_paths, cobol_paths, copybook_paths, copybook_mapping, dd_copybook_mapping, base_s3_path, input_path_prefix, output_path_prefix) -> DataFlowConfig`
  - Main orchestration: parse JCL -> COBOL -> Copybook, enrich schemas, extract transformations
  - Infers input/output from COBOL when JCL is absent
  - Creates pass-through transforms when no COBOL logic found

### mainframe_parser/parsers/jcl_parser.py — JCL/PROC Parser
**Class: DDStatement** — JCL DD statement (ddname, dsn, disp, unit, space, dcb, is_input, is_output)

**Class: JCLParser**
- `parse_file(path) -> Tuple[List[InputConfig], List[OutputConfig]]`
- `parse_content(content) -> Tuple[List[InputConfig], List[OutputConfig]]`
- `parse_exec_steps(content) -> List[dict]` — Parse EXEC statements (returns step, proc, params, condition)
- Classifies DD as input/output via DISP keyword (SHR/OLD=input, NEW/MOD=output)
- Skips intermediate/passed datasets and system DDs

### mainframe_parser/parsers/cobol_parser.py — COBOL Source Parser
**Class: FileDescriptor** — COBOL FD (fd_name, copybook, record_name)
**Class: SelectAssignment** — SELECT...ASSIGN (file_name, dd_name)

**Class: COBOLParser**
- `parse_file(path) -> Tuple[List[FileDescriptor], List[SelectAssignment]]`
- `parse_content(content) -> Tuple[List[FileDescriptor], List[SelectAssignment]]`
- `get_program_context(content, max_chars=8000) -> str` — Truncated PROCEDURE DIVISION
- Uses lookahead to find COPY statement in 01-record under FD

### mainframe_parser/parsers/copybook_parser.py — Copybook Schema Extractor
**Standalone functions:**
- `_expand_pic(pic) -> str` — Expand PIC: XXX->X(3), 9999->9(4)
- `_parse_pic_length(pic) -> Tuple[Optional[int], Optional[int]]` — Extract (length, precision)
- `_cobol_type_to_spark(pic, usage="") -> str` — Map COBOL PIC/USAGE to Spark type
- `_extract_format_hint(line, name, pic_length) -> Optional[str]` — Detect date/time format from comment or name

**Class: CopybookParser**
- `parse_file(path) -> List[FieldDefinition]`
- `parse_content(content) -> List[FieldDefinition]` — Try copybook lib first, fallback to regex
- Handles: PIC/PICTURE clauses, REDEFINES (position reset), COMP-3/BINARY usage, FILLER, OCCURS, 88-level, multi-level groups (HEADER/TRAILER/DATA), JUSTIFIED RIGHT, parameterized copybook prefixes (:TOKEN:-)

### mainframe_parser/parsers/cobol_transformation_extractor.py — Transform Extraction
**Class: COBOLTransformationExtractor**
- `extract_from_content(cobol_content, input_names, output_names) -> Optional[TransformationConfig]`
- `extract_from_files(cobol_paths, input_names, output_names) -> Optional[TransformationConfig]`
- Detects patterns: DR/CR accumulation, JOIN, FILTER, AGGREGATE, MOVE/COMPUTE, SORT/MERGE
- 20+ regex patterns for COBOL verb detection
- Splits MOVE/COMPUTE into accumulation (ADD) and summary (MOVE to SUM_*) steps

### mainframe_parser/file_discovery.py — File Scanner
- `discover_mainframe_files(folder, recursive=True) -> Tuple[List[Path], List[Path], List[Path], List[Path]]`
  - Returns (jcl_paths, proc_paths, cobol_paths, copybook_paths)
  - Extensions: .jcl, .proc/.prc, .cbl/.cob/.cobol, .cpy/.cpybook/.copybook/.copy
  - Deduplicates by filename, skips macOS ._files

### mainframe_parser/keywords.py — Keyword Reference
Constants mapping COBOL verbs and JCL keywords to PySpark concepts:
- COBOL_VERB_TO_PYSPARK: {"ADD": "aggregate", "MOVE": "select", "IF": "filter", "SORT": "sort", ...}
- JCL_DD_KEYWORDS, JCL_DISP_INPUT (SHR, OLD), JCL_DISP_OUTPUT (NEW, MOD)

### util/test_dataflow.py — Test Runner
- `generate_sample_data(config_data, settings) -> dict` — Generate sample rows from field definitions
- `run_dataflow_test(config_path, base_path, settings_path, ...) -> dict` — Run PySpark test as subprocess (blocking)
- `run_dataflow_test_stream(config_path, ...) -> generator` — SSE streaming version
- Reads output files and ctrl files after execution
- Supports FIXED, CSV, PARQUET, DELIMITED formats

### util/zip_import.py — ZIP Import Pipeline
- `generate_config_from_zip(zip_path, config_dir, settings) -> dict` — Extract ZIP, discover artifacts, generate config JSON, save test data

## Config JSON Schema
The canonical config JSON has three top-level keys:
```json
{
  "Inputs": {
    "DD_NAME": { "name", "format", "fields": ["..."], "s3_path", "..." }
  },
  "Outputs": {
    "DD_NAME": { "name", "format", "fields": ["..."], "header_fields", "trailer_fields", "..." }
  },
  "Transformations": {
    "steps": [
      { "id", "type", "source_inputs", "logic", "output_alias" }
    ]
  }
}
```

## Key Design Decisions
1. **Select columns/expressions mutual exclusivity**: In TransformationStep logic, `columns` (projection) and `expressions` (add/compute columns) are mutually exclusive. If `columns` is provided, `.select()` runs and returns immediately; `expressions` are only processed when `columns` is absent.
2. **Fixed-width position normalization**: Multi-record copybooks assign absolute positions across all 01-level groups. Physical records start at position 1, so `_parse_fixed_width_text()` auto-adjusts when `min_start - 1 >= record_length`.
3. **Control files**: Written to `ctrl/<step_id>/<frequency>/<date>/<name>.CTL` by the dataflow engine.
4. **Pydantic v1 API**: Uses `.dict()` not `.model_dump()`. Models use `Field(default_factory=...)` for mutable defaults.

## Dependencies
- Flask >=1.1.2, <2.1
- Pydantic >=1.8, <2.0
- Pandas >=1.1.5, <1.2
- PyArrow >=3.0.0, <6.0
- Python 3.6.8+
