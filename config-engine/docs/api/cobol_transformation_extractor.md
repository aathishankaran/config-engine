# cobol_transformation_extractor

Rule-based extraction of transformation logic from COBOL source programs.

The `COBOLTransformationExtractor` class uses 20+ regex patterns to identify COBOL constructs (MOVE, ADD, COMPUTE, IF, EVALUATE, SORT, MERGE, STRING, UNSTRING, INSPECT, SEARCH) and map them to PySpark transformation equivalents.

::: mainframe_parser.parsers.cobol_transformation_extractor
    options:
      show_root_heading: false
      members_order: source
      filters: ["!^_"]
