# Getting Started

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.6.8 or later |
| pip | Latest recommended |

No external database or message broker is required. Config Engine stores all data as JSON files on the local filesystem.

---

## Installation

```bash
cd config-engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The application starts on **http://localhost:5000** by default.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_DIR` | `./configs` | Directory where dataflow configuration JSON files are stored |

Set the variable before starting the server to change the config storage location:

```bash
export CONFIG_DIR=/path/to/my/configs
python app.py
```

---

## Running Tests

```bash
pytest -v
```

The test suite covers REST API routes, mainframe parser modules, and utility functions. See the [Test Report](test-report.md) for detailed results.

---

## Key Dependencies

| Package | Version Constraint | Purpose |
|---------|--------------------|---------|
| Flask | >=1.1.2, <2.1 | Web framework and REST API |
| Pydantic | >=1.8, <2.0 | Data validation and schema models |
| Pandas | >=1.1.5, <1.2 | Data manipulation for test data |
| PyArrow | >=3.0.0, <6.0 | Parquet file support |

All dependencies are pinned in `requirements.txt` to ensure reproducible builds.

---

## What's Next

- [Developer Guide](developer-guide.md) -- Understand the architecture and module layout.
- [REST API Routes](api-routes.md) -- Explore the 24 available endpoints.
- [Config JSON Schema](config-json-schema.md) -- Learn the configuration file format.
