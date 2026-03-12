# Config JSON Schema

Dataflow configuration files are JSON documents with three top-level keys: **Inputs**, **Outputs**, and **Transformations**. Each file defines a complete data pipeline from source datasets through transformation steps to output targets.

---

## Top-Level Structure

```json
{
  "Inputs": { ... },
  "Outputs": { ... },
  "Transformations": { ... }
}
```

| Key | Type | Description |
|-----|------|-------------|
| `Inputs` | object | Map of input node IDs to input configurations |
| `Outputs` | object | Map of output node IDs to output configurations |
| `Transformations` | object | Map of transformation node IDs to step configurations |

---

## Inputs

Each input is keyed by a unique node ID (e.g., `"input_1"`).

### Input Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name for the input |
| `path` | string | yes | File path or dataset location |
| `format` | string | yes | Data format: `FIXED`, `CSV`, `PARQUET`, `JSON` |
| `delimiter` | string | no | Column delimiter (CSV format only) |
| `header` | boolean | no | Whether file has a header row (CSV) |
| `schema` | array | no | Field definitions for the dataset |
| `header_fields` | array | no | Field definitions for header records (FIXED) |
| `trailer_fields` | array | no | Field definitions for trailer records (FIXED) |
| `header_count` | integer | no | Number of header rows to skip (FIXED) |
| `trailer_count` | integer | no | Number of trailer rows to skip (FIXED) |
| `cobrix` | object | no | Cobrix-specific reader options |
| `copybook` | string | no | Raw copybook content for reference |

### Field Definition

Each entry in `schema`, `header_fields`, or `trailer_fields`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Field name |
| `type` | string | yes | Data type: `string`, `integer`, `decimal`, `date` |
| `start` | integer | no | Start position (1-based, FIXED format) |
| `length` | integer | no | Field length in characters (FIXED format) |
| `format` | string | no | Date/number format pattern (e.g., `yyyyMMdd`) |
| `precision` | integer | no | Decimal precision |
| `scale` | integer | no | Decimal scale |
| `nullable` | boolean | no | Whether the field allows null values |

### Example Input

```json
{
  "input_1": {
    "name": "Customer File",
    "path": "/data/input/customers.dat",
    "format": "FIXED",
    "header_count": 1,
    "trailer_count": 1,
    "header_fields": [
      { "name": "record_type", "type": "string", "start": 1, "length": 1 },
      { "name": "file_date", "type": "string", "start": 2, "length": 8 }
    ],
    "schema": [
      { "name": "record_type", "type": "string", "start": 1, "length": 1 },
      { "name": "customer_id", "type": "string", "start": 2, "length": 10 },
      { "name": "customer_name", "type": "string", "start": 12, "length": 30 },
      { "name": "balance", "type": "decimal", "start": 42, "length": 12, "precision": 12, "scale": 2 }
    ],
    "trailer_fields": [
      { "name": "record_type", "type": "string", "start": 1, "length": 1 },
      { "name": "record_count", "type": "string", "start": 2, "length": 10 }
    ]
  }
}
```

---

## Outputs

Each output is keyed by a unique node ID (e.g., `"output_1"`).

### Output Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name for the output |
| `path` | string | yes | Output file path or dataset location |
| `format` | string | yes | Output format: `FIXED`, `CSV`, `PARQUET`, `JSON` |
| `delimiter` | string | no | Column delimiter (CSV format only) |
| `header` | boolean | no | Whether to write a header row (CSV) |
| `schema` | array | no | Field definitions for output records |
| `header_fields` | array | no | Field definitions for header records (FIXED) |
| `trailer_fields` | array | no | Field definitions for trailer records (FIXED) |
| `header_count` | integer | no | Number of header rows |
| `trailer_count` | integer | no | Number of trailer rows |
| `mode` | string | no | Write mode: `overwrite`, `append` |
| `partitionBy` | array | no | List of column names for partitioned output |
| `copybook` | string | no | Raw copybook content for reference |

### Example Output

```json
{
  "output_1": {
    "name": "Processed Customers",
    "path": "/data/output/customers_processed",
    "format": "PARQUET",
    "mode": "overwrite",
    "schema": [
      { "name": "customer_id", "type": "string" },
      { "name": "customer_name", "type": "string" },
      { "name": "balance", "type": "decimal", "precision": 12, "scale": 2 },
      { "name": "status", "type": "string" }
    ]
  }
}
```

---

## Transformations

Each transformation node is keyed by a unique node ID (e.g., `"transform_1"`).

### Transformation Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name for the transformation |
| `input` | string | yes | Source node ID (input or another transformation) |
| `steps` | array | yes | Ordered list of transformation steps |

### Transformation Step

Each step in the `steps` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Step type (see table below) |
| `columns` | array | no | Column names (for `select`) |
| `expressions` | object | no | Named expressions (for `select` with aliases) |
| `condition` | string | no | Filter condition (SQL-like expression) |
| `join_with` | string | no | Node ID to join with |
| `join_type` | string | no | Join type: `inner`, `left`, `right`, `full` |
| `join_on` | array | no | List of join key column names |
| `group_by` | array | no | Group-by column names |
| `aggregations` | object | no | Aggregation expressions keyed by output name |
| `order_by` | array | no | Sort column specifications |

### Step Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `select` | Select or rename columns | `columns` or `expressions` (mutually exclusive) |
| `filter` | Filter rows by condition | `condition` |
| `join` | Join with another dataset | `join_with`, `join_type`, `join_on` |
| `aggregate` | Group and aggregate | `group_by`, `aggregations` |
| `sort` | Order rows | `order_by` |
| `withColumn` | Add or replace a column | `name`, `expression` |
| `drop` | Drop columns | `columns` |
| `distinct` | Remove duplicate rows | -- |
| `union` | Union with another dataset | `union_with` |

### Example Transformation

```json
{
  "transform_1": {
    "name": "Filter Active Customers",
    "input": "input_1",
    "steps": [
      {
        "type": "filter",
        "condition": "balance > 0"
      },
      {
        "type": "select",
        "columns": ["customer_id", "customer_name", "balance"]
      },
      {
        "type": "sort",
        "order_by": [{ "column": "balance", "direction": "desc" }]
      }
    ]
  }
}
```

---

## Complete Example

```json
{
  "Inputs": {
    "input_1": {
      "name": "Daily Transactions",
      "path": "/data/input/transactions.dat",
      "format": "FIXED",
      "header_count": 1,
      "trailer_count": 1,
      "schema": [
        { "name": "txn_id", "type": "string", "start": 1, "length": 12 },
        { "name": "amount", "type": "decimal", "start": 13, "length": 10, "precision": 10, "scale": 2 },
        { "name": "txn_date", "type": "date", "start": 23, "length": 8, "format": "yyyyMMdd" }
      ]
    }
  },
  "Outputs": {
    "output_1": {
      "name": "Transaction Summary",
      "path": "/data/output/txn_summary",
      "format": "PARQUET",
      "mode": "overwrite",
      "schema": [
        { "name": "txn_date", "type": "date" },
        { "name": "total_amount", "type": "decimal" },
        { "name": "txn_count", "type": "integer" }
      ]
    }
  },
  "Transformations": {
    "transform_1": {
      "name": "Summarize by Date",
      "input": "input_1",
      "steps": [
        {
          "type": "aggregate",
          "group_by": ["txn_date"],
          "aggregations": {
            "total_amount": "sum(amount)",
            "txn_count": "count(txn_id)"
          }
        }
      ]
    }
  }
}
```
