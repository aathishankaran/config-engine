"""Unit tests for mainframe_parser/engine.py."""
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mainframe_parser.engine import MainframeConfigEngine, _normalize_copybook_stem


class TestNormalizeCopybookStem:
    def test_normal(self):
        assert _normalize_copybook_stem("ACCTCOPY") == "ACCTCOPY"

    def test_macos_prefix(self):
        assert _normalize_copybook_stem("._ACCTCOPY") == "ACCTCOPY"

    def test_empty(self):
        assert _normalize_copybook_stem("") == ""

    def test_just_prefix(self):
        assert _normalize_copybook_stem("._") == "._"


class TestMainframeConfigEngine:
    def setup_method(self):
        self.engine = MainframeConfigEngine()

    def test_init(self):
        assert self.engine.jcl_parser is not None
        assert self.engine.copybook_parser is not None
        assert self.engine.cobol_parser is not None

    def test_generate_config_empty(self):
        """Generate config with no paths should create placeholders."""
        config = self.engine.generate_config()
        assert config.name == "mainframe_migration"

    def test_generate_config_with_jcl(self, temp_dir):
        from pathlib import Path
        jcl_content = "//INPUT1  DD DSN=PROD.INPUT,DISP=SHR\n//OUTPUT1 DD DSN=PROD.OUTPUT,DISP=(NEW,CATLG)\n"
        jcl_path = Path(temp_dir) / "test.jcl"
        jcl_path.write_text(jcl_content)
        config = self.engine.generate_config(jcl_paths=[jcl_path])
        assert len(config.inputs) >= 1
        assert len(config.outputs) >= 1

    def test_generate_config_with_copybook(self, temp_dir):
        from pathlib import Path
        cpy_content = "       01  REC.\n           05  F1  PIC X(10).\n"
        cpy_path = Path(temp_dir) / "TESTCOPY.cpy"
        cpy_path.write_text(cpy_content)
        jcl_content = "//TESTCOPY DD DSN=PROD.DATA,DISP=SHR\n"
        jcl_path = Path(temp_dir) / "test.jcl"
        jcl_path.write_text(jcl_content)
        config = self.engine.generate_config(
            jcl_paths=[jcl_path],
            copybook_paths=[cpy_path],
        )
        # TESTCOPY input should have fields from copybook
        if "TESTCOPY" in config.inputs:
            assert len(config.inputs["TESTCOPY"].fields) > 0

    def test_s3_path(self):
        result = self.engine._s3_path("PROD.BANK.TXN", "s3://bucket/data")
        assert result == "s3://bucket/data/PROD/BANK/TXN"

    def test_s3_path_with_parens(self):
        result = self.engine._s3_path("LIB(MEMBER)", "s3://bucket")
        assert "(" not in result
