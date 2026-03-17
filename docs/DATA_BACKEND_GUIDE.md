# Data Backend Guide For `iquip-web`

This document explains how a custom backend should send dataset data to `iquip-web`.
It is written from the current frontend implementation in [DataViewerView.tsx](/home/server/Desktop/Codes/ent/iquip-web/src/views/DataViewerView.tsx).

The goal is practical interoperability:

- what the frontend loads
- how metadata is interpreted
- what data shapes are preferred
- what fallback shapes still work

## Overview

The Data Viewer consumes three things for a run or archive:

1. dataset list
2. dataset metadata
3. dataset data payload

The preferred flow is:

1. `GET /runs/<rid>/datasets/`
2. `GET /runs/<rid>/datasets/<dataset_name>/meta/`
3. `GET /runs/<rid>/datasets/<dataset_name>/data/?format=json`

Archive mode is similar, but the data payload comes from:

1. `GET /archives/<archive_id>/`
2. `GET /archives/<archive_id>/datasets/<dataset_name>/data/?format=json`

## Minimal Contract

At minimum, the frontend needs:

- a dataset name in the dataset list
- a `data` field in the dataset payload

The recommended contract is:

- dataset list returns names
- meta returns `shape`, `dtype`, and `metadata`
- data returns:
  - `columns: string[]`
  - `data: unknown[][]`

## Dataset List

### Preferred response

```json
{
  "rid": 42,
  "datasets": [
    {
      "dataset_id": "ds_3",
      "name": "Dataset_101500",
      "dtype": "float32",
      "shape": [101, 5],
      "updated_at": "2026-03-17T10:15:00Z"
    }
  ]
}
```

### Minimum required fields

- `name`

### Optional fields used for display only

- `dataset_id`
- `dtype`
- `shape`
- `updated_at`

### Legacy fallback also accepted

The frontend also tolerates a plain array:

```json
[
  {
    "id": 3,
    "name": "Dataset_101500",
    "metadata": {}
  }
]
```

This works, but the structured object form is better.

## Dataset Metadata

Metadata is loaded separately and affects how the viewer interprets the payload.

### Preferred response

```json
{
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500",
  "dtype": "float32",
  "shape": [101, 5],
  "units": {
    "dummy_row": "index",
    "row0": "V"
  },
  "parameters": {},
  "hints": {},
  "metadata": {
    "param_axes": ["dummy_row"],
    "data_axes": ["row0", "row1", "row2", "row3"],
    "data_axes_effective": ["row0", "row1", "row2", "row3"]
  }
}
```

## Metadata Fields And Their Meaning

### `shape`

Used as a hint for the matrix-like schema mode.

Expected meaning:

- `[rows, cols]` for a 2D matrix-like payload
- if present and consistent, helps the frontend identify row-oriented data blocks

### `dtype`

Display-only for now.

### `units`

Currently informational.
Not yet used deeply in plotting logic, but should be kept available.

### `parameters`

If present, the frontend adds these keys to field selection in non-schema mode.

Example:

```json
{
  "parameters": {
    "temperature": 4.2,
    "bias": 0.1
  }
}
```

This is useful for object-style or mixed payloads.

### `hints`

Reserved for future use.
Safe to include, but not relied upon heavily today.

### `metadata.param_axes`

Names of parameter axes.

Example:

```json
["dummy_row"]
```

Used in schema mode for the “Variables” selector.

If absent, schema mode falls back to `["index"]`.

### `metadata.data_axes`

Names of data rows in a matrix-style dataset.

Example:

```json
["row0", "row1", "row2", "row3"]
```

This should include all logical data rows, including placeholder names if needed.

### `metadata.data_axes_effective`

Filtered version of `data_axes` for frontend presentation.

Example:

```json
["row0", "row1", "row2", "row3"]
```

If your raw schema uses placeholders like `_`, remove them here.

Example:

```json
{
  "data_axes": ["x", "y", "z", "_"],
  "data_axes_effective": ["x", "y", "z"]
}
```

This is important because the schema-mode selector uses `data_axes_effective` as the user-facing list.

## Preferred Data Payload

### Recommended shape

Send a row table:

```json
{
  "rid": 42,
  "name": "Dataset_101500",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "data": [
    [0, 0, 1, 2, 100],
    [1, 1, 2, 3, 100],
    [2, 2, 3, 4, 100]
  ]
}
```

This is the best format for the current frontend.

Why:

- `columns` gives explicit names for each numeric field
- `data` is naturally plottable
- all dimensions are treated uniformly
- the frontend does not need to distinguish “param” vs “data” columns

## How The Frontend Uses `columns`

If `columns` is present and non-empty:

- field selectors use those names directly
- each row in `data` is treated as a single point record
- `xField`, `yField`, and `zField` are chosen from `columns`

For array rows, field lookup is:

- `columns[i]` -> row element `data_row[i]`

Example:

```json
{
  "columns": ["dummy_row", "row0", "row1"],
  "data": [
    [0, 10, 20],
    [1, 11, 21]
  ]
}
```

The frontend interprets:

- `dummy_row` from column 0
- `row0` from column 1
- `row1` from column 2

## Scalar Dataset Type

The frontend supports a dedicated scalar dataset mode for datasets that contain exactly one numeric value.

### Preferred scalar marker

Use:

```json
{
  "metadata": {
    "dataset_type": "scalar"
  }
}
```

The frontend also accepts:

```json
{
  "hints": {
    "dataset_type": "scalar"
  }
}
```

but `metadata.dataset_type` is the preferred contract.

### Preferred scalar metadata response

```json
{
  "rid": 42,
  "dataset_id": "ds_9",
  "name": "QubitTemperature",
  "dtype": "float64",
  "shape": [],
  "units": {
    "value": "K"
  },
  "metadata": {
    "dataset_type": "scalar"
  }
}
```

### Preferred scalar data response

Best form:

```json
{
  "rid": 42,
  "name": "QubitTemperature",
  "data": 0.023
}
```

Also accepted:

```json
{
  "rid": 42,
  "name": "QubitTemperature",
  "data": [0.023]
}
```

or:

```json
{
  "rid": 42,
  "name": "QubitTemperature",
  "data": {
    "value": 0.023
  }
}
```

### Scalar viewer behavior

For scalar datasets, the frontend opens a minimal viewer:

- dataset title
- one large numeric value
- optional unit from `units.value`

No plot controls are shown for scalar datasets.

## Schema Mode

Schema mode is a special matrix/block mode used when:

- `columns` is empty
- `metadata.data_axes_effective` is present and non-empty

The condition is implemented in [DataViewerView.tsx](/home/server/Desktop/Codes/ent/iquip-web/src/views/DataViewerView.tsx).

In schema mode, the frontend assumes `data` represents row blocks rather than point rows.

### Expected schema-mode payload

```json
{
  "rid": 42,
  "name": "Dataset_101500",
  "data": [
    [0, 1, 2, 3, 4],
    [10, 11, 12, 13, 14],
    [20, 21, 22, 23, 24],
    [30, 31, 32, 33, 34]
  ]
}
```

with metadata:

```json
{
  "metadata": {
    "param_axes": ["dummy_row"],
    "data_axes": ["row0", "row1", "row2", "row3"],
    "data_axes_effective": ["row0", "row1", "row2", "row3"]
  },
  "shape": [4, 5]
}
```

Here:

- outer array length = number of data rows
- each row is a 1D numeric series

The user chooses one entry from `data_axes_effective`, and the frontend plots that selected row.

## Matrix-Like Fallback Detection

Even if `data_axes_effective` is not supplied explicitly, the frontend tries to infer matrix mode from:

- `meta.shape`
- the actual `data` shape

Current inference is roughly:

- 2D array
- row count small enough to look like labeled channels
- column count larger than row count

This fallback exists for compatibility, but you should not rely on it.

Preferred rule:

- if data is row-block structured, send `metadata.data_axes_effective`

## Non-Schema Mode Fallbacks

If `columns` is absent and schema mode is not activated, the frontend falls back to generic field derivation.

### Array rows without `columns`

Example:

```json
{
  "data": [
    [0, 10, 20],
    [1, 11, 21]
  ]
}
```

The frontend synthesizes:

- `col0`
- `col1`
- `col2`

This works, but it is inferior to explicit `columns`.

### Object rows

Example:

```json
{
  "data": [
    { "x": 0, "y": 10, "z": 20 },
    { "x": 1, "y": 11, "z": 21 }
  ]
}
```

The frontend uses the object keys as selectable fields.

This is supported, but the current preferred format is still `columns + array rows`.

### Scalar list

Example:

```json
{
  "data": [1, 2, 3, 4]
}
```

The frontend uses a synthetic field:

- `value`

and also allows:

- `index`

This is acceptable for simple 1D data but not recommended for richer datasets.

## Recommended Unified Format

For custom backends, the recommended standard is:

### Dataset list

```json
{
  "rid": 42,
  "datasets": [
    {
      "dataset_id": "ds_3",
      "name": "Counts",
      "dtype": "float32",
      "shape": [101, 5],
      "updated_at": "2026-03-17T10:15:00Z"
    }
  ]
}
```

### Metadata

```json
{
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Counts",
  "dtype": "float32",
  "shape": [101, 5],
  "units": {
    "dummy_row": "index",
    "row0": "arb"
  },
  "parameters": {},
  "hints": {},
  "metadata": {
    "param_axes": ["dummy_row"],
    "data_axes": ["row0", "row1", "row2", "row3"],
    "data_axes_effective": ["row0", "row1", "row2", "row3"]
  }
}
```

### Data

```json
{
  "rid": 42,
  "name": "Counts",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "data": [
    [0, 0, 1, 2, 100],
    [1, 1, 2, 3, 100],
    [2, 2, 3, 4, 100]
  ]
}
```

This format is the least ambiguous and the most future-proof for the current UI.

## Streaming Format

Dataset streaming is now aligned with the same row-table model used by the HTTP data endpoint.

Preferred websocket route:

- `WS /runs/<rid>/datasets/<dataset_name>/stream/`

The backend should treat websocket delivery as:

- one initial snapshot
- zero or more append messages
- optional reset or error messages

The important rule is that websocket and HTTP should describe the same logical table.

### Snapshot

Send the full current table when the websocket connects:

```json
{
  "type": "snapshot",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Counts",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "data": [
    [0, 0, 1, 2, 100],
    [1, 1, 2, 3, 100],
    [2, 2, 3, 4, 100]
  ],
  "updated_at": "2026-03-17T10:00:00Z"
}
```

This should match the shape returned by:

- `GET /runs/<rid>/datasets/<dataset_name>/data/?format=json`

### Append

When new rows are saved, send only the newly appended rows:

```json
{
  "type": "append",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Counts",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "rows": [
    [3, 3, 4, 5, 100],
    [4, 4, 5, 6, 100]
  ],
  "updated_at": "2026-03-17T10:00:02Z"
}
```

Current frontend behavior on append:

- keeps the current `columns`
- replaces them if the websocket provides an updated `columns` array
- concatenates `rows` onto the local table

### Reset

If the active dataset is cleared or reinitialized, send:

```json
{
  "type": "reset",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Counts"
}
```

The frontend clears the local rows on reset.

### Error

If the dataset cannot be streamed, send:

```json
{
  "type": "error",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Counts",
  "message": "Dataset not found.",
  "updated_at": "2026-03-17T10:00:00Z"
}
```

The frontend displays the message and leaves the current view unchanged.

## Alignment Rule

For custom backends, keep these two payloads logically identical:

1. HTTP snapshot payload
2. websocket snapshot and append payloads

That means:

- the same `columns`
- the same row ordering
- the same interpretation of each value in each column

The websocket should not invent a different data model such as:

- separate `params` and `data`
- `x` plus nested `y`
- transposed row blocks for live data only

If the HTTP payload is:

```json
{
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "data": [
    [0, 0, 1, 2, 100],
    [1, 1, 2, 3, 100]
  ]
}
```

then websocket appends should continue that exact table:

```json
{
  "type": "append",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "rows": [
    [2, 2, 3, 4, 100]
  ]
}
```

## Practical Rules For Backend Authors

### Do this

- send explicit `columns` whenever your dataset is row-oriented
- keep `data` numeric where possible
- provide `metadata.param_axes`
- provide `metadata.data_axes` and `metadata.data_axes_effective` for row-block datasets
- provide `shape` in metadata responses
- keep field names stable across refreshes

### Avoid this

- relying on inferred `col0`, `col1`, etc.
- changing field order between refreshes
- mixing numeric and non-numeric values in the same plotted column
- using schema mode unless you really have row-block data

## Decision Table

### Best choice for most backends

Use:

```json
{
  "columns": ["x", "y", "z"],
  "data": [
    [0, 10, 20],
    [1, 11, 21]
  ]
}
```

### Use schema mode only if the dataset is truly row-block oriented

Use:

```json
{
  "data": [
    [0, 1, 2, 3],
    [10, 11, 12, 13]
  ]
}
```

with metadata:

```json
{
  "metadata": {
    "data_axes_effective": ["row0", "row1"]
  }
}
```

## Summary

If you are building a custom backend for `iquip-web`, the safest contract is:

1. return dataset names from the dataset list endpoint
2. return metadata with `shape` and `metadata.*axes`
3. return data as:

```json
{
  "columns": ["field1", "field2", "field3"],
  "data": [
    [v11, v12, v13],
    [v21, v22, v23]
  ]
}
```

That is the format the current frontend handles most clearly and with the least guesswork.

## Query Language

The Data Viewer also supports a backend query layer for transforming a dataset before plotting.

This is intentionally not raw SQL. The goal is:

- simple enough for users to write
- easy for the backend to validate
- expressive enough for filtering, grouping, and aggregation

### Mental model

Think of every dataset as one in-memory table:

- `columns` are the field names
- each entry in `data` is one row

Example source table:

```json
{
  "columns": ["dummy_row", "row0", "row1", "row2"],
  "data": [
    [0, 10, 20, 1],
    [0, 12, 22, 0],
    [1, 15, 30, 1]
  ]
}
```

You are always querying that one table.

That is why this language has:

- no `FROM`
- no `JOIN`
- no multiple-table logic

The dataset itself is the implicit table.

### Execution order

Queries run in this order:

1. `WHERE`
2. `GROUP BY`
3. `AGG`
4. `SELECT`
5. `ORDER BY`
6. `LIMIT`

Practical meaning:

- `WHERE` filters raw rows first
- `GROUP BY` forms groups from the filtered rows
- `AGG` computes one output row per group
- `SELECT` is for row-level projection when you are not grouping
- `ORDER BY` sorts the final result table
- `LIMIT` trims the final result table

If you are grouping, think in terms of:

- choose group keys with `GROUP BY`
- choose aggregate outputs with `AGG`

If you are not grouping, think in terms of:

- choose output columns with `SELECT`
- optionally filter with `WHERE`

### Supported clauses

Each clause goes on its own line:

- `SELECT`
- `WHERE`
- `GROUP BY`
- `AGG`
- `ORDER BY`
- `LIMIT`

Example:

```text
SELECT dummy_row, row0, row1
WHERE row0 >= 0
ORDER BY dummy_row ASC
LIMIT 500
```

Grouped example:

```text
GROUP BY dummy_row
AGG avg(row1) AS avg_row1, count_if(row2 > 10) AS hits
ORDER BY dummy_row ASC
```

### What a good query looks like

Use `SELECT` for row-wise transforms:

```text
SELECT dummy_row, row0, row1, row0 + row1 AS total
WHERE row2 > 0
ORDER BY dummy_row ASC
LIMIT 200
```

Use `GROUP BY` plus `AGG` for summary plots:

```text
GROUP BY dummy_row
AGG avg(row0) AS avg_row0, max(row1) AS max_row1, count_if(row2 > 0) AS positive_hits
ORDER BY dummy_row ASC
```

### Clause meaning

#### `SELECT`

Projects row-level expressions into a new output table.

Use this when you want one output row for each input row.

Examples:

```text
SELECT dummy_row, row0, row1
SELECT row0 + row1 AS total, abs(row2) AS magnitude
```

Input table:

```json
{
  "columns": ["dummy_row", "row0", "row1"],
  "data": [
    [0, 10, 20],
    [1, 11, 21]
  ]
}
```

Query:

```text
SELECT dummy_row, row0 + row1 AS total
```

Output:

```json
{
  "columns": ["dummy_row", "total"],
  "data": [
    [0, 30],
    [1, 32]
  ]
}
```

#### `WHERE`

Filters rows before any grouping.

Examples:

```text
WHERE row0 > 10
WHERE row0 > 10 and row1 < 20
```

Example:

```text
SELECT dummy_row, row0
WHERE row0 >= 10 and row1 < 25
```

This keeps only rows satisfying the boolean condition.

#### `GROUP BY`

Groups rows by one or more expressions.

Use this when you want one output row per group rather than per input row.

Example:

```text
GROUP BY dummy_row
```

You can also group by derived expressions:

```text
GROUP BY round(dummy_row / 10) AS bin
```

#### `AGG`

Computes aggregate columns for each group.

`AGG` is only meaningful together with `GROUP BY`.

Supported aggregates:

- `sum(expr)`
- `avg(expr)`
- `min(expr)`
- `max(expr)`
- `count()`
- `count_if(condition)`
- `first(expr)`
- `last(expr)`

Example:

```text
AGG avg(row1) AS avg_row1, count_if(row2 > 5) AS hits
```

Input table:

```json
{
  "columns": ["dummy_row", "row0"],
  "data": [
    [0, 10],
    [0, 20],
    [1, 30]
  ]
}
```

Query:

```text
GROUP BY dummy_row
AGG avg(row0) AS avg_row0, count() AS n
ORDER BY dummy_row ASC
```

Output:

```json
{
  "columns": ["dummy_row", "avg_row0", "n"],
  "data": [
    [0, 15.0, 2],
    [1, 30.0, 1]
  ]
}
```

#### `ORDER BY`

Sorts the output table by result columns.

`ORDER BY` applies to the final result table, not the raw dataset.

Example:

```text
ORDER BY dummy_row ASC
ORDER BY avg_row1 DESC
```

#### `LIMIT`

Restricts the number of output rows.

Example:

```text
LIMIT 200
```

### Expression support

Expressions support:

- column names
- numeric constants
- arithmetic: `+`, `-`, `*`, `/`, `%`, `**`
- comparisons: `==`, `!=`, `<`, `<=`, `>`, `>=`
- boolean logic: `and`, `or`, `not`
- parentheses
- simple safe functions:
  - `abs(x)`
  - `round(x, n)`
  - `min(a, b)`
  - `max(a, b)`

This is meant to cover plotting workflows without exposing arbitrary backend code execution.

### Valid examples

Simple projection:

```text
SELECT row0, row1
```

Derived field:

```text
SELECT dummy_row, row0 + row1 AS total
```

Filter plus projection:

```text
SELECT dummy_row, row0
WHERE row0 > 5
ORDER BY dummy_row ASC
```

Grouped average:

```text
GROUP BY dummy_row
AGG avg(row0) AS avg_row0
ORDER BY dummy_row ASC
```

Threshold counting:

```text
GROUP BY dummy_row
AGG count_if(row2 > 10) AS hits
ORDER BY dummy_row ASC
```

First and last values:

```text
GROUP BY dummy_row
AGG first(row0) AS first_row0, last(row0) AS last_row0
```

### Invalid examples

This is not SQL, so these are intentionally unsupported:

```text
SELECT * FROM dataset
```

Reason:

- no `FROM`
- no `*`

This is also invalid:

```text
SELECT avg(row0)
```

Reason:

- aggregate functions belong in `AGG`, not `SELECT`

Use:

```text
GROUP BY dummy_row
AGG avg(row0) AS avg_row0
```

This is also invalid:

```text
HAVING avg(row0) > 10
```

Reason:

- `HAVING` is not part of the language

If you need post-aggregation filtering later, that should be added explicitly as a new clause rather than inferred from SQL expectations.

### Comparison to SQL

The language is deliberately SQL-shaped, but not SQL-complete.

SQL:

```sql
SELECT dummy_row, AVG(row0) AS avg_row0
FROM dataset
WHERE row1 > 0
GROUP BY dummy_row
ORDER BY dummy_row ASC
LIMIT 100;
```

Equivalent query here:

```text
WHERE row1 > 0
GROUP BY dummy_row
AGG avg(row0) AS avg_row0
ORDER BY dummy_row ASC
LIMIT 100
```

Key differences from SQL:

- no `FROM`
- no `JOIN`
- no subqueries
- no `HAVING`
- no window functions
- no write operations
- aggregate expressions belong in `AGG`

That smaller surface area is intentional. It keeps the language easy to validate and easy to map to plot-ready tables.

### Best practices for users

- start by checking the dataset `columns`
- use `SELECT` when you want row-by-row plotting
- use `GROUP BY` plus `AGG` when you want summaries
- keep aliases simple and descriptive
- use `ORDER BY` explicitly if plotting order matters
- use `LIMIT` when exploring large datasets

Good aliases:

```text
AGG avg(row0) AS avg_row0, count_if(row1 > 5) AS hits
```

Less good:

```text
AGG avg(row0) AS a, count_if(row1 > 5) AS b
```

### Query endpoint pattern

Recommended API shape:

- `POST /runs/<rid>/datasets/<dataset_name>/query/`
- `POST /archives/<archive_id>/datasets/<dataset_name>/query/`

Request:

```json
{
  "query": "GROUP BY dummy_row\nAGG avg(row1) AS avg_row1\nORDER BY dummy_row ASC"
}
```

Response:

```json
{
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Counts",
  "columns": ["dummy_row", "avg_row1"],
  "data": [
    [0, 10.5],
    [1, 11.25]
  ],
  "query": {
    "text": "GROUP BY dummy_row\nAGG avg(row1) AS avg_row1\nORDER BY dummy_row ASC",
    "grouped": true,
    "aggregated": true,
    "row_count": 2
  }
}
```

The query result is still just another `columns + rows` table, which is why it integrates cleanly with the rest of the viewer.
