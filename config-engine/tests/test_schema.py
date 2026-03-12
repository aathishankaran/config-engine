"""Unit tests for mainframe_parser/schema.py — Pydantic v1 models."""
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mainframe_parser.schema import (
    FieldDefinition,
    CobrixOptions,
    InputConfig,
    OutputConfig,
    TransformationStep,
    TransformationConfig,
    DataFlowConfig,
)


class TestFieldDefinition:
    def test_create_basic(self):
        f = FieldDefinition(name="TEST-FIELD")
        assert f.name == "TEST-FIELD"
        assert f.type == "string"
        assert f.nullable is True
        assert f.record_type == "DATA"

    def test_create_with_all_fields(self):
        f = FieldDefinition(
            name="AMOUNT",
            type="decimal",
            start=10,
            length=7,
            precision=2,
            nullable=False,
            format="YYYYMMDD",
            source="COBOL-COPY",
            record_type="HEADER",
            just_right=True,
        )
        assert f.type == "decimal"
        assert f.start == 10
        assert f.length == 7
        assert f.precision == 2
        assert f.record_type == "HEADER"
        assert f.just_right is True

    def test_dict_serialization(self):
        f = FieldDefinition(name="ID", type="long", start=1, length=5)
        d = f.dict()
        assert isinstance(d, dict)
        assert d["name"] == "ID"
        assert d["type"] == "long"

    def test_dict_exclude_none(self):
        f = FieldDefinition(name="TEST")
        d = f.dict(exclude_none=True)
        assert "start" not in d
        assert "length" not in d
        assert "format" not in d

    def test_default_values(self):
        f = FieldDefinition(name="X")
        assert f.just_right is False
        assert f.record_type == "DATA"
        assert f.type == "string"


class TestCobrixOptions:
    def test_defaults(self):
        c = CobrixOptions()
        assert c.encoding == "cp037"
        assert c.record_format == "F"
        assert c.file_start_offset == 0
        assert c.generate_record_id is False

    def test_custom_values(self):
        c = CobrixOptions(
            copybook_path="s3://bucket/copy.cpy",
            encoding="cp273",
            record_format="V",
        )
        assert c.copybook_path == "s3://bucket/copy.cpy"
        assert c.encoding == "cp273"


class TestInputConfig:
    def test_create(self):
        inp = InputConfig(name="TXNIN")
        assert inp.name == "TXNIN"
        assert inp.format == "cobol"
        assert inp.fields == []

    def test_with_fields(self):
        inp = InputConfig(
            name="INPUT1",
            format="fixed",
            fields=[FieldDefinition(name="F1"), FieldDefinition(name="F2")],
        )
        assert len(inp.fields) == 2
        assert inp.fields[0].name == "F1"


class TestOutputConfig:
    def test_create(self):
        out = OutputConfig(name="REPORT")
        assert out.name == "REPORT"
        assert out.format == "parquet"
        assert out.write_mode == "overwrite"
        assert out.header_fields == []
        assert out.trailer_fields == []

    def test_with_header_trailer(self):
        out = OutputConfig(
            name="OUT",
            header_fields=[FieldDefinition(name="HDR-DATE")],
            trailer_fields=[FieldDefinition(name="TRL-COUNT")],
        )
        assert len(out.header_fields) == 1
        assert len(out.trailer_fields) == 1


class TestTransformationStep:
    def test_create(self):
        step = TransformationStep(id="step1", type="filter")
        assert step.id == "step1"
        assert step.type == "filter"
        assert step.source_inputs == []
        assert step.logic == {}

    def test_with_logic(self):
        step = TransformationStep(
            id="filter1",
            type="filter",
            source_inputs=["INPUT1"],
            logic={"conditions": [{"field": "AMT", "operation": ">", "value": 0}]},
            output_alias="filtered",
        )
        assert step.output_alias == "filtered"
        assert "conditions" in step.logic


class TestDataFlowConfig:
    def test_create_empty(self):
        cfg = DataFlowConfig()
        assert cfg.name == "mainframe_migration"
        assert cfg.inputs == {}
        assert cfg.outputs == {}

    def test_to_json_config(self):
        cfg = DataFlowConfig(
            inputs={"IN1": InputConfig(name="IN1")},
            outputs={"OUT1": OutputConfig(name="OUT1")},
            transformations=TransformationConfig(
                steps=[TransformationStep(id="s1", type="select")]
            ),
        )
        j = cfg.to_json_config()
        assert "Inputs" in j
        assert "Outputs" in j
        assert "Transformations" in j
        assert "IN1" in j["Inputs"]
        assert "OUT1" in j["Outputs"]

    def test_to_json_config_excludes_cobrix(self):
        cfg = DataFlowConfig(
            inputs={
                "IN1": InputConfig(
                    name="IN1",
                    cobrix=CobrixOptions(copybook_path="/path/copy.cpy"),
                )
            },
        )
        j = cfg.to_json_config()
        assert "cobrix" not in j["Inputs"]["IN1"]

    def test_to_json_config_handles_sets(self):
        """Sets in logic should be converted to lists."""
        cfg = DataFlowConfig(
            transformations=TransformationConfig(
                steps=[
                    TransformationStep(
                        id="s1",
                        type="select",
                        logic={"columns": {"col1", "col2"}},
                    )
                ]
            ),
        )
        j = cfg.to_json_config()
        cols = j["Transformations"]["steps"][0]["logic"]["columns"]
        assert isinstance(cols, list)
