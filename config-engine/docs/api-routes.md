# REST API Routes

Config Engine exposes 24 HTTP endpoints for configuration management, mainframe artifact parsing, and test execution.

---

## Route Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Serve index.html |
| GET | `/studio` | Serve Dataflow Studio |
| GET | `/runbook` | Serve user runbook |
| GET | `/api/settings` | Get application settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/configs` | List all config files |
| GET | `/api/config/<path>` | Get one config JSON |
| GET | `/api/config/<path>/test-data` | Get test data (auto re-parses FIXED) |
| PUT | `/api/config/<path>` | Save/create config JSON |
| DELETE | `/api/config/<path>` | Delete config and test data |
| POST | `/api/config/<path>/rename` | Rename config file |
| GET | `/api/search?q=<query>` | Search across configs |
| POST | `/api/import-files` | Import mainframe files |
| POST | `/api/import-zip` | Import ZIP archive |
| POST | `/api/test/generate-sample` | Generate sample test data |
| POST | `/api/test/run` | Run dataflow test (blocking) |
| POST | `/api/test/run-stream` | Run dataflow test (SSE streaming) |
| GET | `/api/config/<path>/download` | Download config JSON |
| POST | `/api/parse-copybook` | Parse copybook content |
| POST | `/api/config/<path>/node-test-file` | Save node test data file |
| POST | `/api/config/<path>/last-run-file` | Save last run date file |
| POST | `/api/config/<path>/rename-node-test-data` | Rename test data keys |
| POST | `/api/config/<path>/node-copybook` | Save node copybook file |

---

## Detailed Endpoint Descriptions

### Settings

#### `GET /api/settings`

Returns the current application settings from `settings.json`.

**Response:** `200 OK` with JSON settings object.

#### `PUT /api/settings`

Updates application settings. Accepts a full or partial settings object.

**Request body:** JSON object with settings fields to update.

**Response:** `200 OK` with the updated settings object.

---

### Configuration CRUD

#### `GET /api/configs`

Lists all configuration JSON files in the config directory.

**Response:** `200 OK` with a JSON array of config file metadata (name, path, last modified).

#### `GET /api/config/<path>`

Retrieves a single configuration JSON file by its path.

**Parameters:**

| Parameter | Location | Description |
|-----------|----------|-------------|
| `path` | URL path | Config file path relative to config directory |

**Response:** `200 OK` with the full config JSON, or `404 Not Found`.

#### `PUT /api/config/<path>`

Creates or updates a configuration JSON file.

**Parameters:**

| Parameter | Location | Description |
|-----------|----------|-------------|
| `path` | URL path | Config file path relative to config directory |

**Request body:** Full dataflow configuration JSON object.

**Response:** `200 OK` on success.

#### `DELETE /api/config/<path>`

Deletes a configuration file and its associated test data.

**Response:** `200 OK` on success, or `404 Not Found`.

#### `POST /api/config/<path>/rename`

Renames a configuration file.

**Request body:**

```json
{
  "new_name": "new-config-name"
}
```

**Response:** `200 OK` with the new path.

---

### Test Data

#### `GET /api/config/<path>/test-data`

Retrieves test data for a configuration. Automatically re-parses stale fixed-width data when all values are empty or the schema has changed.

**Response:** `200 OK` with test data keyed by node ID.

#### `POST /api/test/generate-sample`

Generates synthetic sample test data matching the input schemas defined in a configuration.

**Request body:**

```json
{
  "config_path": "my-config",
  "node_id": "input_1",
  "num_rows": 10
}
```

**Response:** `200 OK` with generated sample data rows.

---

### Test Execution

#### `POST /api/test/run`

Runs a dataflow test synchronously. Invokes `dataflow-engine/run_dataflow.py` as a subprocess and waits for completion.

**Request body:**

```json
{
  "config_path": "my-config",
  "test_data": { ... }
}
```

**Response:** `200 OK` with execution results including outputs and control files.

#### `POST /api/test/run-stream`

Runs a dataflow test with Server-Sent Events (SSE) streaming. Returns real-time stdout/stderr from the subprocess.

**Request body:** Same as `/api/test/run`.

**Response:** `200 OK` with `Content-Type: text/event-stream`. Events include `log`, `error`, `output`, `ctrl`, and `done`.

---

### Import

#### `POST /api/import-files`

Imports mainframe artifact files (JCL, COBOL, Copybook) and generates a dataflow configuration.

**Request body:** `multipart/form-data` with uploaded files.

**Response:** `200 OK` with the generated configuration JSON.

#### `POST /api/import-zip`

Imports a ZIP archive containing mainframe artifacts. Extracts, discovers, parses, and generates configuration.

**Request body:** `multipart/form-data` with a single ZIP file.

**Response:** `200 OK` with the generated configuration JSON.

---

### Copybook Parsing

#### `POST /api/parse-copybook`

Parses raw copybook text content and returns the extracted field schema.

**Request body:**

```json
{
  "content": "01  RECORD.\n    05  FIELD-A  PIC X(10).\n    05  FIELD-B  PIC 9(5)."
}
```

**Response:** `200 OK` with an array of field definitions (name, type, start, length).

---

### Node-Level File Operations

#### `POST /api/config/<path>/node-test-file`

Saves raw test data for a specific node within a configuration.

**Request body:**

```json
{
  "node_id": "input_1",
  "content": "raw file content..."
}
```

#### `POST /api/config/<path>/last-run-file`

Saves the last run date for a configuration.

#### `POST /api/config/<path>/rename-node-test-data`

Renames test data keys when a node ID changes.

**Request body:**

```json
{
  "old_id": "input_1",
  "new_id": "input_renamed"
}
```

#### `POST /api/config/<path>/node-copybook`

Saves raw copybook content associated with a specific node.

---

### Utility

#### `GET /api/search?q=<query>`

Searches across all configuration files for a text match.

**Query parameters:**

| Parameter | Description |
|-----------|-------------|
| `q` | Search query string |

**Response:** `200 OK` with an array of matching config file paths and snippets.

#### `GET /api/config/<path>/download`

Downloads a configuration JSON file as an attachment.

**Response:** `200 OK` with `Content-Disposition: attachment` header.
