# test_dataflow

Test orchestration module for generating sample data and running dataflow tests.

Manages the full test lifecycle: sample data generation matching input schemas, subprocess execution of `dataflow-engine/run_dataflow.py`, output file reading (Parquet, CSV, fixed-width), control file reading, and SSE result streaming.

::: util.test_dataflow
    options:
      show_root_heading: false
      members_order: source
      filters: []
