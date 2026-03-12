# jcl_parser

JCL and PROC parser for extracting input/output datasets from DD statements.

Contains the `DDStatement` data class and `JCLParser` class. Classifies datasets as inputs or outputs based on the DISP parameter (OLD/SHR = input, NEW/MOD = output).

::: mainframe_parser.parsers.jcl_parser
    options:
      show_root_heading: false
      members_order: source
      filters: ["!^_"]
