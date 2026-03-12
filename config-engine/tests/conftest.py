import json
import os
import sys
import tempfile
import shutil
import pytest

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def app():
    """Create Flask test app."""
    from app import app as flask_app
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def client(app):
    """Create Flask test client."""
    return app.test_client()


@pytest.fixture
def temp_dir():
    """Create a temporary directory, clean up after test."""
    d = tempfile.mkdtemp()
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def sample_config():
    """Return a sample dataflow config dict."""
    return {
        "Inputs": {
            "TEST-INPUT": {
                "name": "TEST-INPUT",
                "format": "CSV",
                "fields": [
                    {"name": "ID", "type": "string", "start": 1, "length": 5},
                    {"name": "AMOUNT", "type": "long", "start": 6, "length": 10},
                    {"name": "STATUS", "type": "string", "start": 16, "length": 3},
                ],
                "s3_path": "s3://test/input",
            }
        },
        "Outputs": {
            "TEST-OUTPUT": {
                "name": "TEST-OUTPUT",
                "format": "CSV",
                "fields": [
                    {"name": "ID", "type": "string"},
                    {"name": "AMOUNT", "type": "long"},
                ],
                "s3_path": "s3://test/output",
            }
        },
        "Transformations": {
            "steps": [
                {
                    "id": "filter_step",
                    "type": "filter",
                    "source_inputs": ["TEST-INPUT"],
                    "logic": {
                        "conditions": [{"field": "AMOUNT", "operation": ">", "value": 0}]
                    },
                    "output_alias": "TEST-OUTPUT",
                }
            ]
        },
    }


@pytest.fixture
def sample_copybook_text():
    """Sample COBOL copybook content."""
    return """       01  TRANSACTION-RECORD.
           05  TXN-ID              PIC X(10).
           05  TXN-DATE            PIC 9(8).       *> YYYYMMDD
           05  TXN-AMOUNT          PIC S9(7)V99.
           05  TXN-TYPE            PIC X(2).
           05  FILLER              PIC X(5).
           05  TXN-STATUS          PIC X(1).
"""
