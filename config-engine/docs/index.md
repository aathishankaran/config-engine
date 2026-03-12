# Config Engine

**Flask web application (port 5000)** for managing dataflow configurations, parsing mainframe artifacts (JCL, COBOL, Copybook), visual editing via Dataflow Studio, and test execution against the dataflow-engine.

---

## Main Features

- **REST API** -- 24 endpoints for configuration CRUD, settings management, test execution, and file import/export.
- **Mainframe Parser Pipeline** -- Automated conversion of JCL, COBOL source, and Copybook files into PySpark dataflow configuration JSON.
- **Dataflow Studio UI** -- Browser-based visual editor for building and editing dataflow configurations with drag-and-drop nodes.
- **Test Runner** -- Generate sample data, execute dataflow-engine as a subprocess, and stream results back via SSE.

---

## Quick Links

| Page | Description |
|------|-------------|
| [Getting Started](getting-started.md) | Installation, prerequisites, and first run |
| [Developer Guide](developer-guide.md) | Architecture, project structure, and module reference |
| [REST API Routes](api-routes.md) | All 24 HTTP endpoints with request/response details |
| [Config JSON Schema](config-json-schema.md) | Full schema for dataflow configuration files |
| [Design Decisions](design-decisions.md) | Rationale behind key architectural choices |
| [Test Report](test-report.md) | Test suite results and coverage |
| [API Reference](api/app.md) | Auto-generated Python API docs (mkdocstrings) |

---

## Feature Highlights

!!! note "Mainframe Artifact Parsing"
    Config Engine includes a complete pipeline for converting legacy mainframe artifacts into modern dataflow configurations. Upload JCL procedures, COBOL source programs, and copybook definitions -- the parser extracts datasets, field schemas, and transformation logic automatically.

!!! tip "Visual Dataflow Editing"
    Dataflow Studio provides a drag-and-drop canvas for building data pipelines. Define input sources, transformation steps, and output targets visually. The studio generates and maintains the underlying JSON configuration in real time.

!!! info "Integrated Test Execution"
    Run end-to-end tests directly from the UI. The test runner generates sample fixed-width or delimited data, invokes the PySpark dataflow-engine as a subprocess, and streams stdout/stderr back to the browser via Server-Sent Events.

!!! warning "Python Version Compatibility"
    Config Engine targets Python 3.6.8+ with Pydantic v1 and Flask <2.1. See the [Getting Started](getting-started.md) guide for the full dependency matrix.
