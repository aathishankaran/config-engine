"""Unit tests for mainframe_parser/parsers/copybook_parser.py."""
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mainframe_parser.parsers.copybook_parser import (
    CopybookParser,
    _expand_pic,
    _parse_pic_length,
    _cobol_type_to_spark,
    _extract_format_hint,
)


class TestExpandPic:
    def test_single_char(self):
        assert _expand_pic("X") == "X"

    def test_repeated_x(self):
        assert _expand_pic("XXX") == "X(3)"

    def test_repeated_9(self):
        assert _expand_pic("9999") == "9(4)"

    def test_already_parenthesized(self):
        assert _expand_pic("X(10)") == "X(10)"

    def test_mixed(self):
        result = _expand_pic("S9(5)V99")
        assert "V9(2)" in result

    def test_single_9(self):
        assert _expand_pic("9") == "9"


class TestParsePicLength:
    def test_numeric(self):
        length, prec = _parse_pic_length("9(5)")
        assert length == 5
        assert prec is None

    def test_numeric_with_decimal(self):
        length, prec = _parse_pic_length("9(7)V9(2)")
        assert length == 9
        assert prec == 2

    def test_alphanumeric(self):
        length, prec = _parse_pic_length("X(10)")
        assert length == 10
        assert prec is None

    def test_signed_numeric(self):
        length, prec = _parse_pic_length("S9(5)")
        assert length == 5

    def test_single_x(self):
        length, prec = _parse_pic_length("X")
        assert length == 1

    def test_v_inline_decimals(self):
        length, prec = _parse_pic_length("9(5)V99")
        assert prec == 2
        assert length == 7


class TestCobolTypeToSpark:
    def test_alphanumeric(self):
        assert _cobol_type_to_spark("X(10)") == "string"

    def test_numeric(self):
        assert _cobol_type_to_spark("9(5)") == "long"

    def test_signed_numeric(self):
        assert _cobol_type_to_spark("S9(5)") == "long"

    def test_decimal(self):
        assert _cobol_type_to_spark("S9(7)V9(2)") == "decimal"

    def test_comp3(self):
        assert _cobol_type_to_spark("9(5)", "COMP-3") == "double"

    def test_comp(self):
        assert _cobol_type_to_spark("9(5)", "COMP") == "long"

    def test_comp1(self):
        assert _cobol_type_to_spark("", "COMP-1") == "double"

    def test_binary(self):
        assert _cobol_type_to_spark("9(5)", "BINARY") == "long"

    def test_default_string(self):
        assert _cobol_type_to_spark("") == "string"

    def test_z_edited(self):
        assert _cobol_type_to_spark("Z(5)") == "string"


class TestExtractFormatHint:
    def test_yyyymmdd_from_comment(self):
        line = "       05  TXN-DATE    PIC 9(8).  *> YYYYMMDD"
        assert _extract_format_hint(line, "TXN-DATE", 8) == "YYYYMMDD"

    def test_date_name_heuristic_8(self):
        assert _extract_format_hint("", "PROCESS-DATE", 8) == "YYYYMMDD"

    def test_date_name_heuristic_6(self):
        assert _extract_format_hint("", "RUN-DATE", 6) == "YYYYMM"

    def test_time_name_heuristic(self):
        assert _extract_format_hint("", "START-TIME", 6) == "HHMMSS"

    def test_no_hint(self):
        assert _extract_format_hint("", "CUSTOMER-NAME", 20) is None


class TestCopybookParser:
    def test_parse_basic_copybook(self, sample_copybook_text):
        parser = CopybookParser()
        fields = parser.parse_content(sample_copybook_text)
        assert len(fields) >= 4  # TXN-ID, TXN-DATE, TXN-AMOUNT, TXN-TYPE, TXN-STATUS (FILLER skipped)
        names = [f.name for f in fields]
        assert "TXN-ID" in names
        assert "TXN-AMOUNT" in names
        # FILLER should not be in output
        assert "FILLER" not in names

    def test_field_types(self, sample_copybook_text):
        parser = CopybookParser()
        fields = parser.parse_content(sample_copybook_text)
        by_name = {f.name: f for f in fields}
        assert by_name["TXN-ID"].type == "string"
        assert by_name["TXN-TYPE"].type == "string"
        assert by_name["TXN-AMOUNT"].type == "decimal"

    def test_field_positions(self, sample_copybook_text):
        parser = CopybookParser()
        fields = parser.parse_content(sample_copybook_text)
        # First field should start at position 1
        assert fields[0].start == 1

    def test_date_format_detection(self, sample_copybook_text):
        parser = CopybookParser()
        fields = parser.parse_content(sample_copybook_text)
        by_name = {f.name: f for f in fields}
        # TXN-DATE has *> YYYYMMDD comment
        date_field = by_name.get("TXN-DATE")
        if date_field:
            assert date_field.format == "YYYYMMDD"

    def test_empty_content(self):
        parser = CopybookParser()
        fields = parser.parse_content("")
        assert fields == []

    def test_multi_record_copybook(self):
        content = """       01  HEADER-RECORD.
           05  HDR-ID              PIC X(5).
           05  HDR-DATE            PIC 9(8).
       01  DATA-RECORD.
           05  DATA-ID             PIC X(10).
           05  DATA-AMT            PIC 9(7)V99.
       01  TRAILER-RECORD.
           05  TRL-COUNT           PIC 9(6).
"""
        parser = CopybookParser()
        fields = parser.parse_content(content)
        by_name = {f.name: f for f in fields}
        assert by_name["HDR-ID"].record_type == "HEADER"
        assert by_name["DATA-ID"].record_type == "DATA"
        assert by_name["TRL-COUNT"].record_type == "TRAILER"

    def test_redefines(self):
        content = """       01  TEST-RECORD.
           05  FIELD-A             PIC X(10).
           05  FIELD-B REDEFINES FIELD-A PIC 9(10).
           05  FIELD-C             PIC X(5).
"""
        parser = CopybookParser()
        fields = parser.parse_content(content)
        names = [f.name for f in fields]
        assert "FIELD-A" in names
        # FIELD-B redefines FIELD-A, should have same start
        assert "FIELD-C" in names

    def test_parse_file(self, temp_dir):
        from pathlib import Path
        content = "       01  REC.\n           05  F1  PIC X(5).\n"
        path = Path(temp_dir) / "test.cpy"
        path.write_text(content)
        parser = CopybookParser()
        fields = parser.parse_file(path)
        assert len(fields) == 1
        assert fields[0].name == "F1"
