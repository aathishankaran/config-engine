# Parser Engine

Confluence-style wiki + IDE for viewing and editing dataflow configuration JSON files. Displays configs as **dataflow diagrams** with popups for transformation logic, **search** across all JSON files, and **edit/save** with drag-and-drop to add transformations.

## Features

- **Left sidebar**: List of all config JSON files under the config directory
- **Search** (top right): Search across all JSON files; results show file, path, and highlighted snippet; click to open
- **Dataflow diagram**: Inputs (green) → Transformation steps (blue) → Outputs (orange); click a node for a **popup** with full logic/JSON
- **Import (one shot)**: Upload a ZIP with JCL, COBOL, and copybook (.cpy) files — config and schema are generated in one step
- **Edit mode**: Toggle "Edit mode"; drag transformation types from the left palette onto the diagram to add steps; click a step to edit or delete; **Save** updates the JSON file

## Setup

```bash
cd parser-engine
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Open http://127.0.0.1:5000

## Config directory

By default the app reads JSON files from the `configs/` folder in this project. To use another directory (e.g. your PySpark framework samples):

```bash
export CONFIG_DIR=/path/to/dataflow-engine
python app.py
```

Or set `CONFIG_DIR` in `app.py` to point to `../dataflow-engine/samples` to browse that project's configs.

## Settings (runtime configuration)

Use **Settings** in the app navigation to configure:

- **Use LLM for parsing** — When on, mainframe ZIP import uses an LLM (Lambda/OpenAI-compatible API) to generate config. When off, the **simple Python (rule-based) parser** is used.
- **Input / output dataset path prefix** — S3 (or base) path to prepend to input and output dataset paths. Mainframe programs do not contain this; set it here (e.g. `s3://my-bucket/data`).
- **LLM API base URL** — Leave empty for default OpenAI. For a Lambda or custom endpoint, set the base URL.
- **LLM model** — Model name (e.g. `gpt-4o-mini`). The API key must be set in the server environment: `OPENAI_API_KEY` or `LLM_API_KEY`.
- **Config directory override** — Optional path to the folder where configuration JSON files are stored.

Settings are stored in `static/config/settings.json`.

**Using a local LLM (e.g. Ollama):** See [LOCAL_LLM.md](LOCAL_LLM.md) for steps to install and run a local LLM and point the app at it.

## Project structure

```
parser-engine/
├── app.py              # Flask API: list configs, get/save config, search, import ZIP
├── configs/            # Default folder for config JSON files
│   └── sample_config.json
├── mainframe_parser/   # JCL, COBOL, copybook parsing
├── static/
│   ├── config/
│   │   └── settings.json   # Runtime settings (use LLM, path prefix, etc.); created when you save Settings
│   ├── css/
│   │   └── styles.css
│   ├── index.html      # Single-page Confluence-like UI
│   └── app.js          # Diagram (vis-network), search, edit, save
├── util/
│   └── zip_import.py   # Import from ZIP (JCL + COBOL + copybooks in one shot)
├── llm_config_generator.py  # Optional: LLM (Lambda/OpenAI-compatible) to generate config from artifacts
├── requirements.txt
└── README.md
```
