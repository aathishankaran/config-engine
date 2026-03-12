# Developer Guide

## Architecture

Config Engine is a Flask web application that provides four core capabilities:

1. **REST API** -- 24 HTTP endpoints for managing dataflow configuration JSON files (CRUD, search, import/export).
2. **Mainframe Parser Pipeline** -- Converts JCL procedures, COBOL source programs, and copybook definitions into PySpark dataflow configuration JSON.
3. **Dataflow Studio UI** -- A browser-based visual editor served as static HTML/CSS/JS for building dataflow configurations.
4. **Test Runner** -- Generates sample data, invokes the `dataflow-engine` PySpark application as a subprocess, and streams results back to the client via Server-Sent Events (SSE).

---

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
│       └── cobol_transformation_extractor.py  # Rule-based COBOL transforms
└── util/
    ├── test_dataflow.py                # Test runner (PySpark subprocess)
    └── zip_import.py                   # ZIP import pipeline
```

---

## Module Reference

### app.py

The main Flask application file containing all 24 REST API routes and several internal helper functions.

**Key helper functions:**

| Function | Purpose |
|----------|---------|
| `_load_settings()` | Read `settings.json` from the static config directory |
| `_save_settings(data)` | Write updated settings back to `settings.json` |
| `_get_config_dir()` | Resolve the config directory from `CONFIG_DIR` env var or default |
| `_config_path(name)` | Build the full filesystem path for a config file by name |
| `_parse_fixed_width_text(text, fields, ...)` | Parse fixed-width text into rows using field start/length definitions |
| `_safe_json_dump(obj)` | Serialize objects to JSON with fallback handling for non-serializable types |
| `_find_json_files(directory)` | Recursively discover `.json` config files in a directory |
| `_parse_ctrl_file_text(text)` | Parse control file text into structured key-value data |

See the [REST API Routes](api-routes.md) page for the complete endpoint reference.

---

### schema.py

Pydantic v1 data models that define the dataflow configuration JSON schema.

| Model | Purpose |
|-------|---------|
| `FieldDefinition` | Single field with name, type, start position, length, and format |
| `CobrixOptions` | Options specific to the Cobrix fixed-width reader |
| `InputConfig` | Input dataset definition (path, format, schema, header/trailer) |
| `OutputConfig` | Output dataset definition (path, format, schema, partitioning) |
| `TransformationStep` | One transformation step (select, filter, join, aggregate, sort, etc.) |
| `TransformationConfig` | Ordered list of transformation steps for a dataflow |
| `DataFlowConfig` | Top-level model with `inputs`, `outputs`, and `transformations`; includes `to_json_config()` for serialization |

!!! warning "Pydantic v1 API"
    This project uses Pydantic v1. Use `.dict()` instead of `.model_dump()`, and `@validator` instead of `@field_validator`.

---

### engine.py

The `MainframeConfigEngine` class orchestrates the full mainframe-to-config conversion pipeline.

**Pipeline stages in `generate_config()`:**

1. Discover mainframe files using `file_discovery`
2. Parse JCL/PROC files to extract DD statements (inputs and outputs)
3. Parse COBOL source to extract FD and SELECT...ASSIGN references
4. Parse copybooks to extract field schemas with type mapping
5. Extract transformation logic from COBOL source
6. Assemble everything into a `DataFlowConfig` and serialize to JSON

---

### keywords.py

Two constant dictionaries used by the parser pipeline:

- **`COBOL_VERB_TO_PYSPARK`** -- Maps COBOL verbs (MOVE, ADD, COMPUTE, EVALUATE, PERFORM, etc.) to PySpark transformation equivalents.
- **`JCL_DD_KEYWORDS`** -- Maps JCL DD parameter keywords to their functional categories.

---

### file_discovery.py

The `discover_mainframe_files()` function scans a directory for mainframe artifact files.

**Recognized extensions:**

| Extension | Type |
|-----------|------|
| `.jcl` | JCL procedure |
| `.proc` | JCL procedure |
| `.cbl` | COBOL source |
| `.cpy` | Copybook definition |

Returns a dictionary keyed by file type with lists of discovered file paths.

---

### jcl_parser.py

Parses JCL and PROC files to extract DD (Data Definition) statements.

**Key classes:**

- **`DDStatement`** -- Represents a single DD statement with dataset name, disposition, and I/O classification.
- **`JCLParser`** -- Parses JCL text content, classifying DD statements as inputs or outputs based on DISP parameter values (OLD/SHR = input, NEW/MOD = output).

---

### cobol_parser.py

Parses COBOL source programs to extract file references.

**Key classes:**

- **`FileDescriptor`** -- Represents an FD (File Description) entry with record layouts.
- **`SelectAssignment`** -- Represents a SELECT...ASSIGN TO clause linking a logical file to a physical dataset.
- **`COBOLParser`** -- Extracts FD entries and SELECT assignments, cross-referencing logical file names with physical dataset names.

---

### copybook_parser.py

Parses COBOL copybook definitions to extract field schemas.

**`CopybookParser` capabilities:**

- PIC clause expansion (e.g., `PIC X(10)` to string length 10)
- Type mapping (PIC X = string, PIC 9 = integer/decimal, PIC S9 = signed)
- COMP-3 (packed decimal) field handling
- REDEFINES support
- Multi-record copybook support (multiple 01-level groups)
- Absolute start position calculation across record types

---

### cobol_transformation_extractor.py

The `COBOLTransformationExtractor` class uses 20+ regex patterns to extract transformation logic from COBOL source programs.

**Supported COBOL constructs:**

| COBOL Construct | PySpark Equivalent |
|-----------------|-------------------|
| MOVE | select (column rename/copy) |
| ADD / SUBTRACT / MULTIPLY / DIVIDE | withColumn (arithmetic) |
| COMPUTE | withColumn (expression) |
| IF / EVALUATE | filter / when-otherwise |
| PERFORM ... VARYING | aggregate (group by) |
| SORT | orderBy |
| MERGE | join |
| STRING / UNSTRING | concat / split |
| INSPECT TALLYING | count/sum aggregate |
| SEARCH / SEARCH ALL | lookup join |

---

### test_dataflow.py

Test orchestration module that manages the full test lifecycle:

1. **Sample data generation** -- Creates synthetic fixed-width or delimited test data matching input schemas.
2. **Subprocess execution** -- Invokes `dataflow-engine/run_dataflow.py` as a Python subprocess with the test configuration.
3. **Output reading** -- Reads generated output files (Parquet, CSV, fixed-width) and control files.
4. **Result streaming** -- Sends execution progress and results back to the UI via SSE (Server-Sent Events).

---

### zip_import.py

ZIP import pipeline that automates config generation from archived mainframe artifacts:

1. Extract ZIP contents to a temporary directory
2. Discover mainframe files by extension (`.jcl`, `.proc`, `.cbl`, `.cpy`)
3. Pass discovered files through the `MainframeConfigEngine` pipeline
4. Return the generated configuration JSON

---

## Key Patterns

### Fixed-Width Parsing

The `_parse_fixed_width_text()` function in `app.py` handles multi-record copybooks where different 01-level groups have different absolute start positions. When the minimum start position exceeds the line length, the function subtracts the offset to normalize positions back to zero-based.

### Test Data Re-Parsing

The `get_config_test_data` route automatically re-parses stale fixed-width test data from raw files on disk when it detects all-empty values in stored rows or a schema mismatch with the current field definitions.

### Control File Reading

Control files are stored in a nested directory structure: `ctrl/<step_id>/<frequency>/<date>/<name>.CTL`. The reader uses `rglob("*")` rather than `iterdir()` to recursively discover files at any depth.
