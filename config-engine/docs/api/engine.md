# engine

Main orchestration engine that converts mainframe artifacts into PySpark dataflow configuration JSON.

The `MainframeConfigEngine` class coordinates the full pipeline: file discovery, JCL parsing, COBOL parsing, copybook parsing, transformation extraction, and final config assembly.

::: mainframe_parser.engine
    options:
      show_root_heading: false
      members_order: source
      filters: ["!^_"]
