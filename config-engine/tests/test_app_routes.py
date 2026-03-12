"""Unit tests for app.py Flask routes."""
import pytest
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestSettingsRoutes:
    def test_get_settings(self, client):
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert "use_llm" in data

    def test_put_settings(self, client):
        resp = client.put(
            "/api/settings",
            data=json.dumps({"llm_timeout_seconds": 999}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data.get("ok") is True


class TestConfigRoutes:
    def test_list_configs(self, client):
        resp = client.get("/api/configs")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert "configs" in data

    def test_get_nonexistent_config(self, client):
        resp = client.get("/api/config/DOES-NOT-EXIST-12345.json")
        assert resp.status_code == 404

    def test_create_and_get_config(self, client, sample_config):
        # Create
        resp = client.put(
            "/api/config/UNIT-TEST-TEMP.json",
            data=json.dumps(sample_config),
            content_type="application/json",
        )
        assert resp.status_code == 200

        # Read back
        resp = client.get("/api/config/UNIT-TEST-TEMP.json")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert "Inputs" in data or "inputs" in data

        # Cleanup
        client.delete("/api/config/UNIT-TEST-TEMP.json")

    def test_delete_config(self, client, sample_config):
        # Create first
        client.put(
            "/api/config/UNIT-TEST-DEL.json",
            data=json.dumps(sample_config),
            content_type="application/json",
        )
        # Delete
        resp = client.delete("/api/config/UNIT-TEST-DEL.json")
        assert resp.status_code == 200
        # Verify gone
        resp = client.get("/api/config/UNIT-TEST-DEL.json")
        assert resp.status_code == 404

    def test_rename_config(self, client, sample_config):
        # Create
        client.put(
            "/api/config/UNIT-TEST-RENAME.json",
            data=json.dumps(sample_config),
            content_type="application/json",
        )
        # Rename
        resp = client.post(
            "/api/config/UNIT-TEST-RENAME.json/rename",
            data=json.dumps({"new_name": "UNIT-TEST-RENAMED.json"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        # Old gone
        resp = client.get("/api/config/UNIT-TEST-RENAME.json")
        assert resp.status_code == 404
        # New exists
        resp = client.get("/api/config/UNIT-TEST-RENAMED.json")
        assert resp.status_code == 200
        # Cleanup
        client.delete("/api/config/UNIT-TEST-RENAMED.json")


class TestSearchRoute:
    def test_search_empty_query(self, client):
        resp = client.get("/api/search?q=")
        assert resp.status_code == 200

    def test_search_with_query(self, client):
        resp = client.get("/api/search?q=NONEXISTENTXYZ")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert "results" in data


class TestStaticRoutes:
    def test_index(self, client):
        resp = client.get("/")
        # Should serve index.html or redirect
        assert resp.status_code in (200, 302, 304)

    def test_studio(self, client):
        resp = client.get("/studio")
        assert resp.status_code in (200, 302, 304)
