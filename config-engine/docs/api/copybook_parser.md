# copybook_parser

COBOL copybook parser for extracting field schemas with type mapping.

Handles PIC clause expansion, type mapping (X=string, 9=integer/decimal, S9=signed), COMP-3 packed decimal, REDEFINES, and multi-record copybooks with multiple 01-level groups.

::: mainframe_parser.parsers.copybook_parser
    options:
      show_root_heading: false
      members_order: source
      filters: []
