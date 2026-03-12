"""Unit tests for app.py helper functions."""
import pytest
import json
import sys
import os
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import _parse_fixed_width_text, _safe_json_dump, _find_json_files


class TestParseFixedWidthText:
    def test_basic_parsing(self):
        text = "ABCDE12345XYZ"
        fields = [
            {"name": "F1", "start": 1, "length": 5},
            {"name": "F2", "start": 6, "length": 5},
            {"name": "F3", "start": 11, "length": 3},
        ]
        rows = _parse_fixed_width_text(text, fields)
        assert len(rows) == 1
        assert rows[0]["F1"] == "ABCDE"
        assert rows[0]["F2"] == "12345"
        assert rows[0]["F3"] == "XYZ"

    def test_multiple_lines(self):
        text = "AAA111\nBBB222\n"
        fields = [
            {"name": "NAME", "start": 1, "length": 3},
            {"name": "NUM", "start": 4, "length": 3},
        ]
        rows = _parse_fixed_width_text(text, fields)
        assert len(rows) == 2
        assert rows[0]["NAME"] == "AAA"
        assert rows[1]["NUM"] == "222"

    def test_skip_headers(self):
        text = "HEADER\nDATA1X\nDATA2Y\n"
        fields = [{"name": "VAL", "start": 1, "length": 6}]
        rows = _parse_fixed_width_text(text, fields, header_count=1)
        assert len(rows) == 2

    def test_skip_trailers(self):
        text = "DATA1\nDATA2\nTRAIL\n"
        fields = [{"name": "VAL", "start": 1, "length": 5}]
        rows = _parse_fixed_width_text(text, fields, trailer_count=1)
        assert len(rows) == 2

    def test_empty_text(self):
        rows = _parse_fixed_width_text("", [{"name": "F", "start": 1, "length": 5}])
        assert rows == []

    def test_position_normalization(self):
        """Multi-record copybook with high start positions."""
        text = "ABCDE"
        fields = [
            {"name": "F1", "start": 121, "length": 3},
            {"name": "F2", "start": 124, "length": 2},
        ]
        rows = _parse_fixed_width_text(text, fields)
        assert len(rows) == 1
        # Should auto-adjust: 121-1=120 offset subtracted
        assert rows[0]["F1"] == "ABC"
        assert rows[0]["F2"] == "DE"


class TestSafeJsonDump:
    def test_normal_dict(self):
        import io
        buf = io.StringIO()
        _safe_json_dump({"key": "value"}, buf)
        result = json.loads(buf.getvalue())
        assert result["key"] == "value"

    def test_converts_sets(self):
        import io
        buf = io.StringIO()
        _safe_json_dump({"items": {"a", "b"}}, buf)
        result = json.loads(buf.getvalue())
        assert isinstance(result["items"], list)
        assert set(result["items"]) == {"a", "b"}

    def test_nested_sets(self):
        import io
        buf = io.StringIO()
        _safe_json_dump({"outer": {"inner": {1, 2}}}, buf)
        result = json.loads(buf.getvalue())
        assert isinstance(result["outer"]["inner"], list)


class TestFindJsonFiles:
    def test_find_json_files(self, temp_dir):
        from pathlib import Path
        (Path(temp_dir) / "config1.json").write_text("{}")
        (Path(temp_dir) / "config2.json").write_text("{}")
        (Path(temp_dir) / "readme.txt").write_text("not json")
        files = _find_json_files(Path(temp_dir))
        assert len(files) == 2
        names = [f["name"] for f in files]
        assert "config1.json" in names

    def test_skip_test_data(self, temp_dir):
        from pathlib import Path
        td = Path(temp_dir) / "test_data"
        td.mkdir()
        (td / "data.json").write_text("{}")
        (Path(temp_dir) / "config.json").write_text("{}")
        files = _find_json_files(Path(temp_dir))
        assert len(files) == 1

    def test_nonexistent_dir(self):
        from pathlib import Path
        files = _find_json_files(Path("/nonexistent"))
        assert files == []
