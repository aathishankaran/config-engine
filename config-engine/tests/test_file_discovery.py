"""Unit tests for mainframe_parser/file_discovery.py."""
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pathlib import Path
from mainframe_parser.file_discovery import discover_mainframe_files


class TestDiscoverMainframeFiles:
    def test_discover_empty_dir(self, temp_dir):
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert jcl == []
        assert proc == []
        assert cobol == []
        assert cpy == []

    def test_discover_jcl(self, temp_dir):
        (Path(temp_dir) / "test.jcl").write_text("//JOB")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert len(jcl) == 1

    def test_discover_cobol(self, temp_dir):
        (Path(temp_dir) / "prog.cbl").write_text("IDENTIFICATION DIVISION.")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert len(cobol) == 1

    def test_discover_copybook(self, temp_dir):
        (Path(temp_dir) / "copy.cpy").write_text("01 REC. 05 F PIC X.")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert len(cpy) == 1

    def test_discover_proc(self, temp_dir):
        (Path(temp_dir) / "proc.proc").write_text("//PROC")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert len(proc) == 1

    def test_skip_macos_resource_fork(self, temp_dir):
        (Path(temp_dir) / "._test.cpy").write_text("resource fork")
        (Path(temp_dir) / "test.cpy").write_text("01 REC.")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert len(cpy) == 1  # Only real file, not ._

    def test_recursive_discovery(self, temp_dir):
        sub = Path(temp_dir) / "sub"
        sub.mkdir()
        (sub / "test.jcl").write_text("//JOB")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir), recursive=True)
        assert len(jcl) == 1

    def test_non_recursive(self, temp_dir):
        sub = Path(temp_dir) / "sub"
        sub.mkdir()
        (sub / "test.jcl").write_text("//JOB")
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir), recursive=False)
        assert len(jcl) == 0

    def test_not_a_directory(self):
        with pytest.raises(NotADirectoryError):
            discover_mainframe_files(Path("/nonexistent/path"))

    def test_deduplication(self, temp_dir):
        (Path(temp_dir) / "test.jcl").write_text("//JOB")
        sub = Path(temp_dir) / "sub"
        sub.mkdir()
        (sub / "test.jcl").write_text("//JOB")  # Same name
        jcl, proc, cobol, cpy = discover_mainframe_files(Path(temp_dir))
        assert len(jcl) == 1  # Deduped by name
