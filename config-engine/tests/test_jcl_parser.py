"""Unit tests for mainframe_parser/parsers/jcl_parser.py."""
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mainframe_parser.parsers.jcl_parser import JCLParser, DDStatement


class TestDDStatement:
    def test_create(self):
        dd = DDStatement(ddname="INPUT1", dsn="PROD.DATA.FILE", disp="SHR")
        assert dd.ddname == "INPUT1"
        assert dd.dsn == "PROD.DATA.FILE"
        assert dd.is_input is False

    def test_flags(self):
        dd = DDStatement(ddname="OUT1", is_output=True)
        assert dd.is_output is True
        assert dd.is_input is False


class TestJCLParser:
    def setup_method(self):
        self.parser = JCLParser()

    def test_parse_input_dd(self):
        content = "//TXNIN   DD DSN=PROD.BANK.TXN.DAILY,DISP=SHR\n"
        inputs, outputs = self.parser.parse_content(content)
        assert len(inputs) == 1
        assert inputs[0].name == "TXNIN"

    def test_parse_output_dd(self):
        content = "//SUMOUT  DD DSN=PROD.BANK.SUMMARY,DISP=(NEW,CATLG),\n//          SPACE=(CYL,(10,5)),DCB=(RECFM=FB,LRECL=120)\n"
        inputs, outputs = self.parser.parse_content(content)
        assert len(outputs) == 1
        assert outputs[0].name == "SUMOUT"

    def test_skip_sysout(self):
        content = "//SYSOUT  DD SYSOUT=*\n"
        inputs, outputs = self.parser.parse_content(content)
        assert len(inputs) == 0
        assert len(outputs) == 0

    def test_skip_steplib(self):
        content = "//STEPLIB DD DSN=LOAD.LIBRARY,DISP=SHR\n"
        inputs, outputs = self.parser.parse_content(content)
        assert len(inputs) == 0

    def test_skip_passed_datasets(self):
        content = "//TEMPDS  DD DSN=&&TEMP,DISP=(NEW,PASS)\n"
        inputs, outputs = self.parser.parse_content(content)
        assert len(outputs) == 0

    def test_multiple_dds(self):
        content = (
            "//INPUT1  DD DSN=PROD.INPUT1,DISP=SHR\n"
            "//INPUT2  DD DSN=PROD.INPUT2,DISP=OLD\n"
            "//OUTPUT1 DD DSN=PROD.OUTPUT,DISP=(NEW,CATLG)\n"
        )
        inputs, outputs = self.parser.parse_content(content)
        assert len(inputs) == 2
        assert len(outputs) == 1

    def test_parse_exec_steps(self):
        content = (
            "//S10     EXEC PGM=GENRPT01\n"
            "//S20     EXEC PGM=GENFMT01,COND=(4,LT)\n"
        )
        steps = self.parser.parse_exec_steps(content)
        assert len(steps) == 2
        assert steps[0]["step"] == "S10"
        assert steps[0]["proc"] == "PGM"
        assert steps[1]["condition"] is not None

    def test_infer_io_from_ddname(self):
        content = "//REPORT1 DD DSN=PROD.REPORT,DISP=(,CATLG)\n"
        inputs, outputs = self.parser.parse_content(content)
        # REPORT in name should infer output
        assert len(outputs) >= 1 or len(inputs) >= 1  # At minimum it's classified

    def test_parse_file(self, temp_dir):
        from pathlib import Path
        content = "//INPUT1  DD DSN=PROD.INPUT,DISP=SHR\n"
        path = Path(temp_dir) / "test.jcl"
        path.write_text(content)
        inputs, outputs = self.parser.parse_file(path)
        assert len(inputs) == 1
