"""Unit tests for mainframe_parser/parsers/cobol_parser.py."""
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mainframe_parser.parsers.cobol_parser import COBOLParser, FileDescriptor, SelectAssignment


class TestFileDescriptor:
    def test_create(self):
        fd = FileDescriptor(fd_name="SRC_IN", copybook="GENIN01")
        assert fd.fd_name == "SRC_IN"
        assert fd.copybook == "GENIN01"
        assert fd.record_name is None


class TestSelectAssignment:
    def test_create(self):
        sa = SelectAssignment(file_name="TXN_FILE", dd_name="TXNIN")
        assert sa.file_name == "TXN_FILE"
        assert sa.dd_name == "TXNIN"


class TestCOBOLParser:
    def setup_method(self):
        self.parser = COBOLParser()

    def test_parse_select_assign(self):
        content = "       SELECT TXN-FILE ASSIGN TO 'TXNIN'.\n"
        fds, selects = self.parser.parse_content(content)
        assert len(selects) == 1
        assert selects[0].file_name == "TXN_FILE"

    def test_parse_fd_with_copy(self):
        content = (
            "       FD  SRC-IN\n"
            "           RECORDING MODE IS F\n"
            "           BLOCK CONTAINS 0 RECORDS.\n"
            "       01  SRC-REC.\n"
            "           COPY GENIN01.\n"
        )
        fds, selects = self.parser.parse_content(content)
        assert len(fds) >= 1
        assert fds[0].copybook == "GENIN01"

    def test_parse_fd_without_copy(self):
        content = (
            "       FD  MY-FILE\n"
            "           RECORDING MODE IS F.\n"
            "       01  MY-RECORD.\n"
            "           05  FIELD-A    PIC X(10).\n"
        )
        fds, selects = self.parser.parse_content(content)
        assert len(fds) >= 1
        assert fds[0].copybook is None

    def test_get_program_context(self):
        content = (
            "       IDENTIFICATION DIVISION.\n"
            "       PROGRAM-ID. TESTPROG.\n"
            "       PROCEDURE DIVISION.\n"
            "           PERFORM PROCESS-RECORDS.\n"
            "           STOP RUN.\n"
        )
        ctx = self.parser.get_program_context(content)
        assert "PERFORM" in ctx
        assert "STOP" in ctx

    def test_get_program_context_truncation(self):
        content = "       PROCEDURE DIVISION.\n" + "       MOVE A TO B.\n" * 1000
        ctx = self.parser.get_program_context(content, max_chars=100)
        assert len(ctx) <= 120  # some overhead for truncation message

    def test_parse_file(self, temp_dir):
        from pathlib import Path
        content = "       SELECT MY-FILE ASSIGN TO 'MYDD'.\n       FD  MY-FILE.\n       01  REC.\n           05  F1  PIC X(5).\n"
        path = Path(temp_dir) / "test.cbl"
        path.write_text(content)
        fds, selects = self.parser.parse_file(path)
        assert len(selects) == 1
        assert len(fds) >= 1

    def test_multiple_selects(self):
        content = (
            "       SELECT FILE-A ASSIGN TO 'DD1'.\n"
            "       SELECT FILE-B ASSIGN TO 'DD2'.\n"
        )
        fds, selects = self.parser.parse_content(content)
        assert len(selects) == 2

    def test_hyphen_replacement(self):
        content = "       SELECT TXN-FILE ASSIGN TO 'TXNIN'.\n"
        fds, selects = self.parser.parse_content(content)
        # Hyphens should be replaced with underscores
        assert selects[0].file_name == "TXN_FILE"
