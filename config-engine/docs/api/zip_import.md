# zip_import

ZIP import pipeline for generating config JSON from mainframe artifact archives.

Extracts ZIP contents to a temporary directory, discovers mainframe files by extension (`.jcl`, `.proc`, `.cbl`, `.cpy`), passes them through the `MainframeConfigEngine` pipeline, and returns the generated configuration JSON.

::: util.zip_import
    options:
      show_root_heading: false
      members_order: source
      filters: ["!^_"]
