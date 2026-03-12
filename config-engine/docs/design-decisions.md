# Design Decisions

This page documents key architectural and implementation decisions in Config Engine, along with the rationale behind each.

---

## 1. Select Columns and Expressions Are Mutually Exclusive

**Decision:** In a `select` transformation step, the `columns` field and `expressions` field cannot both be present. Only one may be specified.

**Rationale:**

- `columns` provides a simple list of column names to keep (pass-through selection).
- `expressions` provides a dictionary of output names mapped to SQL-like expressions (computed selection with possible renames).
- Allowing both simultaneously creates ambiguity about ordering and precedence -- should plain columns appear before or after computed expressions? What if an expression references a column not in the `columns` list?
- Enforcing mutual exclusivity makes each step's intent unambiguous: either you are selecting existing columns by name, or you are computing new columns from expressions.

**In practice:** The Dataflow Studio UI enforces this by presenting two distinct editing modes for select steps. The dataflow-engine validates this constraint at runtime and raises an error if both fields are populated.

---

## 2. Fixed-Width Position Normalization for Multi-Record Copybooks

**Decision:** When parsing multi-record copybooks (multiple 01-level groups), the parser assigns absolute start positions across all groups. At parse time, the system detects when `min_start - 1 >= len(line)` and subtracts `min_start - 1` from all start positions to normalize them back to physical line boundaries.

**Rationale:**

- COBOL copybooks with multiple 01-level groups define separate physical record layouts. Each physical record is its own line in the data file, starting at position 1.
- The copybook parser computes absolute positions by accumulating lengths across all 01-level groups, which produces correct offsets within each group but incorrect absolute offsets for groups after the first.
- Rather than restructuring the parser to track group boundaries (which would complicate the otherwise straightforward position accumulation logic), the normalization is applied at read time in both `_parse_fixed_width_text()` and `api_save_node_test_file`.
- This approach keeps the parser simple and single-pass while correctly handling the physical reality of separate record lines.

---

## 3. Pydantic v1 API

**Decision:** Config Engine uses Pydantic v1 (>=1.8, <2.0) throughout the schema module.

**Rationale:**

- The target runtime is Python 3.6.8+, which Pydantic v2 does not support (v2 requires Python 3.8+).
- Pydantic v1 provides adequate validation, serialization, and schema generation for the configuration models.
- This means the codebase uses `.dict()` (not `.model_dump()`), `@validator` (not `@field_validator`), and `schema_extra` in `Config` inner classes.

!!! warning "Migration Note"
    If the project migrates to Python 3.8+ in the future, upgrading to Pydantic v2 would require updating all model definitions to use the v2 API. The `pydantic.v1` compatibility shim could ease the transition.

---

## 4. Control File Directory Structure

**Decision:** Control files are written to a nested directory path: `ctrl/<step_id>/<frequency>/<date>/<name>.CTL`.

**Rationale:**

- The directory hierarchy encodes metadata (step, frequency, date) in the path itself, making it possible to locate control files without a database or index.
- This structure mirrors how mainframe batch systems organize control files, maintaining conceptual compatibility with the source environment.
- The nesting requires `rglob("*")` instead of `iterdir()` when reading control files, since the reader does not always know the exact frequency or date subdirectory in advance.
- The trade-off of deeper nesting versus flat storage was deemed acceptable because control files are small and infrequent, and the hierarchical layout aids manual debugging and inspection.
