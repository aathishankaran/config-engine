"""
Mainframe to PySpark Configuration Generator (Python parser only).

Converts mainframe artifacts (COBOL, JCL, PROC, Copybook) into
configuration JSON for PySpark data flow execution.
"""

from .keywords import (
    COBOL_VERB_TO_PYSPARK,
    JCL_DD_KEYWORDS,
    JCL_DISP_INPUT,
    JCL_DISP_OUTPUT,
)
from .schema import (
    CobrixOptions,
    DataFlowConfig,
    InputConfig,
    OutputConfig,
    TransformationConfig,
)

__all__ = [
    "COBOL_VERB_TO_PYSPARK",
    "JCL_DD_KEYWORDS",
    "JCL_DISP_INPUT",
    "JCL_DISP_OUTPUT",
    "CobrixOptions",
    "DataFlowConfig",
    "InputConfig",
    "OutputConfig",
    "TransformationConfig",
]
