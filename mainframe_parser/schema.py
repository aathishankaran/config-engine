"""
Configuration JSON schema for PySpark data flow.

This schema defines the intermediate layer between mainframe data processing
and PySpark execution on AWS cloud.
"""

from typing import Any
from pydantic import BaseModel, Field


class FieldDefinition(BaseModel):
    """Schema for a single field in input/output."""

    name: str
    type: str = "string"  # string, int, long, double, decimal, date, timestamp
    start: int | None = None  # Starting position (1-based or 0-based byte offset) for fixed-width/delimited
    length: int | None = None
    precision: int | None = None
    nullable: bool = True
    format: str | None = None  # Format pattern e.g. YYYYMMDD, YYYYMM, HHMMSS
    source: str | None = None  # Source copybook field reference
    record_type: str = "DATA"  # "DATA" | "HEADER" | "TRAILER" — set by copybook parser from 01-level group name


class CobrixOptions(BaseModel):
    """Cobrix-specific options for reading mainframe EBCDIC files in PySpark."""

    copybook_path: str | None = Field(None, description="Path to copybook file (S3 or local)")
    encoding: str = Field("cp037", description="EBCDIC encoding (cp037=US, cp273=German, etc.)")
    record_format: str = Field("F", description="F=Fixed, V=Variable, D=Variable with RDW")
    file_start_offset: int = Field(0, description="Byte offset to start reading")
    file_end_offset: int = Field(0, description="Byte offset from end to stop reading")
    generate_record_id: bool = Field(False, description="Add File_Id and Record_Id columns")


class InputConfig(BaseModel):
    """Configuration for a single input source."""

    name: str = Field(..., description="DD name or logical input identifier")
    dataset: str | None = Field(None, description="Mainframe dataset name (DSN)")
    format: str = Field(
        "cobol",
        description="cobol (Cobrix/EBCDIC), parquet, csv, fixed",
    )
    copybook: str | None = Field(None, description="Copybook file path for Cobrix")
    cobrix: CobrixOptions | None = Field(None, description="Cobrix options for mainframe files")
    fields: list[FieldDefinition] = Field(default_factory=list)
    s3_path: str | None = Field(None, description="Target S3 path in AWS")
    metadata: dict[str, Any] = Field(default_factory=dict)


class OutputConfig(BaseModel):
    """Configuration for a single output destination."""

    name: str = Field(..., description="DD name or logical output identifier")
    dataset: str | None = Field(None, description="Mainframe dataset name")
    format: str = Field(
        "parquet",
        description="parquet, csv, cobol (Cobrix for EBCDIC output)",
    )
    copybook: str | None = Field(None, description="Copybook for Cobrix EBCDIC output")
    fields: list[FieldDefinition] = Field(default_factory=list)
    header_fields: list[FieldDefinition] = Field(
        default_factory=list,
        description="Fields written into the header record row(s) with computed expressions",
    )
    trailer_fields: list[FieldDefinition] = Field(
        default_factory=list,
        description="Fields written into the trailer record row(s) with computed expressions",
    )
    output_columns: list[str] | None = Field(
        None,
        description="Explicit list of column names to write (from copybook). Runner selects only these.",
    )
    s3_path: str | None = Field(None, description="Target S3 path in AWS")
    write_mode: str = "overwrite"  # overwrite, append
    metadata: dict[str, Any] = Field(default_factory=dict)


class TransformationStep(BaseModel):
    """A single transformation step in the data flow."""

    id: str
    description: str = ""
    type: str = "select"  # select, filter, join, aggregate, union, custom
    source_inputs: list[str] = Field(default_factory=list)
    logic: dict[str, Any] = Field(
        default_factory=dict,
        description="Transformation logic (columns, conditions, expressions). "
        "Optional 'working_storage': list of names (e.g. WS_DEBIT_TOTAL) for mainframe in-memory temp variables; "
        "ADD/SUBTRACT/MULTIPLY to a missing target are treated as 0/0/1 + expression.",
    )
    output_alias: str | None = None


class TransformationConfig(BaseModel):
    """Configuration for data transformations."""

    steps: list[TransformationStep] = Field(default_factory=list)
    description: str = ""


class DataFlowConfig(BaseModel):
    """
    Complete data flow configuration for PySpark.

    Serves as the intermediate layer between mainframe and AWS PySpark execution.
    """

    name: str = "mainframe_migration"
    description: str = ""
    inputs: dict[str, InputConfig] = Field(default_factory=dict)
    outputs: dict[str, OutputConfig] = Field(default_factory=dict)
    transformations: TransformationConfig = Field(default_factory=TransformationConfig)
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata (source program, JCL reference, etc.)",
    )

    def to_json_config(self) -> dict:
        """Export as the canonical JSON format for PySpark framework. Cobrix block is excluded from Inputs (runtime-only)."""
        def _convert_sets(obj):
            """Recursively convert sets to lists for JSON serialization."""
            if isinstance(obj, set):
                return list(obj)
            elif isinstance(obj, dict):
                return {k: _convert_sets(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [_convert_sets(item) for item in obj]
            else:
                return obj
        
        inputs_dict = {
            k: _convert_sets(v.model_dump(exclude_none=True, exclude={"cobrix"}))
            for k, v in self.inputs.items()
        }
        outputs_dict = {
            k: _convert_sets(v.model_dump(exclude_none=True))
            for k, v in self.outputs.items()
        }
        transformations_dict = _convert_sets(self.transformations.model_dump(exclude_none=True))
        
        return {
            "Inputs": inputs_dict,
            "Outputs": outputs_dict,
            "Transformations": transformations_dict,
        }
