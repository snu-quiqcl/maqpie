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

Dataset streaming is currently weakly defined in the UI and backend.

The frontend currently expects websocket messages of the form:

### Reset

```json
{
  "type": "reset",
  "rid": 42,
  "name": "Counts"
}
```

### Append

```json
{
  "type": "append",
  "rid": 42,
  "name": "Counts",
  "points": [
    {
      "index": 0,
      "x": 1.0,
      "y": [1, 2, 3]
    }
  ],
  "updated_at": "2026-03-17T10:00:00Z"
}
```

Current frontend behavior on append:

- converts each point into `[x, y]`
- appends to local `data`

This is not yet aligned with the preferred `columns + row table` model.

So for custom backends:

- snapshot APIs matter most today
- websocket dataset streaming should be treated as provisional unless you also adapt the frontend

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
