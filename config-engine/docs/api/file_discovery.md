# file_discovery

Discover mainframe artifact files from a directory by extension.

Scans for `.jcl`, `.proc`, `.cbl`, and `.cpy` files and returns them grouped by type. Used as the first stage of the mainframe parser pipeline.

::: mainframe_parser.file_discovery
    options:
      show_root_heading: false
      members_order: source
      filters: ["!^_"]
