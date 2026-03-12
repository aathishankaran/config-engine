# cobol_parser

COBOL source parser for extracting file references (FD, SELECT...ASSIGN).

Contains `FileDescriptor`, `SelectAssignment`, and `COBOLParser` classes. Cross-references logical file names from SELECT statements with physical dataset names from FD entries.

::: mainframe_parser.parsers.cobol_parser
    options:
      show_root_heading: false
      members_order: source
      filters: ["!^_"]
