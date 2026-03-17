# Frontend API Reference

This document describes the API surface used by the React frontend in `iquip-web`.
It is written from the frontend point of view, based on:

- [api.ts](/home/server/Desktop/Codes/ent/iquip-web/src/lib/api.ts)
- [types.ts](/home/server/Desktop/Codes/ent/iquip-web/src/lib/types.ts)
- backend routing in [urls.py](/home/server/Desktop/Codes/ent/quail/quail/urls.py)
- websocket routing in [routing.py](/home/server/Desktop/Codes/ent/quail/datahandler/routing.py)

## Conventions

### Base URL

The frontend uses `VITE_API_BASE` or `localStorage["api_base"]`.

Default:

```text
http://localhost:8000/api
```

All REST paths below are relative to that base.

### Authentication

REST requests send:

```http
Authorization: Token <auth_token>
Content-Type: application/json
```

The token is stored in `localStorage["auth_token"]`.

### WebSocket URL construction

The frontend converts the API base to a websocket base and appends:

```text
?token=<auth_token>
```

Example:

```text
ws://localhost:8000/runs/stream/?token=...
```

## Shared Types

### Priority

`priority: number`

Any integer is accepted. Higher means more important.

### Schedule Type

```json
"NOW" | "TIMED" | "RECURRING"
```

### Recurrence Rule

```json
{
  "kind": "interval" | "daily" | "weekly",
  "timezone": "Asia/Seoul",
  "interval_min": 10,
  "start_immediately": true,
  "start_at": "2026-03-17T12:00",
  "time": "09:30",
  "every_n_days": 1,
  "weekdays": [0, 2, 4],
  "every_n_weeks": 1,
  "start_date": "2026-03-17"
}
```

Notes:

- `interval` uses `interval_min`, optional `start_immediately`, optional `start_at`.
- `daily` uses `time`, optional `every_n_days`.
- `weekly` uses `time`, `weekdays`, optional `every_n_weeks`.
- `weekdays` use `0-6` for `Mon-Sun`.

## Auth

### `POST /login/`

Used by: `api.login(username, password)`

Request body:

```json
{
  "username": "string",
  "password": "string"
}
```

Expected response:

```json
{
  "token": "string",
  "username": "string",
  "user_id": 1
}
```

### `POST /logout/`

Used by: `api.logout()`

Request body:

```json
{}
```

Expected response:

- No body required by the frontend.

## Files

### `GET /files/?type=<type>&path=<path>`

Used by: `api.listFiles(type, path?)`

Query parameters:

- `type`: `"script"` or `"fpga"`; required
- `path`: string; optional

Expected response:

```json
{
  "type": "script",
  "path": "relative/or/absolute/path",
  "items": [
    {
      "name": "example.qil",
      "kind": "file",
      "size": 123,
      "modified_at": "2026-03-17T10:00:00Z"
    }
  ]
}
```

### `GET /files/read/?type=<type>&path=<path>`

Used by: `api.readFile(type, path)`

Query parameters:

- `type`: `"script"` or `"fpga"`; required
- `path`: string; required

Expected response:

```json
{
  "path": "example.qil",
  "content": "file contents..."
}
```

## Panels

### `POST /panels/`

Used by: `api.createPanel(req)`

Request body:

```json
{
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "class_name": "OptionalClass",
  "description": "optional",
  "tags": ["calibration", "q1"]
}
```

Expected response:

```json
{
  "panel_id": "pan_abcd1234",
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "description": "optional",
  "tags": ["calibration"],
  "parameters_schema": {},
  "param_values": {},
  "panel": {
    "fields": [],
    "schedule_defaults": {
      "priority": 3,
      "schedule_type": "NOW",
      "scheduled_at": null,
      "interval_min": null,
      "timezone": "UTC",
      "recurrence": null
    }
  }
}
```

### `POST /panels/inspect-classes/`

Used by: `api.inspectPanelClasses(script_path)`

Request body:

```json
{
  "script_path": "user_scripts/example.py"
}
```

Expected response:

```json
{
  "script_path": "user_scripts/example.py",
  "classes": ["CoolingScan", "RabiScan"]
}
```

### `GET /panels/`

Used by: `api.listPanels(query?)`

Supported query parameters used by the frontend:

- arbitrary string map
- commonly: `script_path`, `tag`, `limit`

Example:

```text
/panels/?limit=20&tag=calibration
```

Expected response:

```json
{
  "items": [/* panel objects */],
  "next_cursor": null
}
```

### `GET /panels/<panel_id>/`

Used by: `api.getPanel(panel_id)`

Path parameters:

- `panel_id`: string; required

Expected response:

- Full `PanelResp`

### `PATCH /panels/<panel_id>/`

Used by: `api.updatePanel(panel_id, body)`

Frontend currently sends a partial panel payload.
Common fields sent:

```json
{
  "param_values": {
    "shots": 100,
    "detuning": 1.25
  },
  "schedule_defaults": {
    "priority": 10,
    "schedule_type": "RECURRING",
    "scheduled_at": null,
    "interval_min": 5,
    "timezone": "Asia/Seoul",
    "recurrence": {
      "kind": "weekly",
      "time": "09:30",
      "weekdays": [0, 2, 4],
      "every_n_weeks": 1,
      "timezone": "Asia/Seoul"
    }
  }
}
```

Expected response:

- Updated `PanelResp`

### `DELETE /panels/<panel_id>/`

Used by: `api.deletePanel(panel_id)`

Path parameters:

- `panel_id`: string; required

Expected response:

- No body required by the frontend.

### `POST /panels/from-config/`

Used by: `api.openPanelFromConfig(config_id)`

Request body:

```json
{
  "config_id": "pcfg_ab12cd"
}
```

Expected response:

- `PanelResp`

## Panel Configs

### `GET /panel-configs/`

Used by: `api.listPanelConfigs(query?)`

Supported query parameters used by the frontend:

- arbitrary string map
- commonly: `script_path`, `class_name`, `tag`, `limit`

Expected response:

```json
{
  "items": [
    {
      "config_id": "pcfg_ab12cd",
      "title": "Default Q1 Config",
      "script_path": "user_scripts/example.qil",
      "class_name": "",
      "tags": ["q1"],
      "updated_at": "2026-03-17T10:00:00Z",
      "updated_by": {
        "user_id": 1,
        "username": "admin"
      }
    }
  ],
  "next_cursor": null
}
```

### `POST /panel-configs/from-panel/`

Used by: `api.createPanelConfigFromPanel(body)`

Request body:

```json
{
  "panel_id": "pan_abcd1234",
  "title": "My Config",
  "tags": ["default", "q1"]
}
```

Expected response:

```json
{
  "config_id": "pcfg_ab12cd",
  "created_at": "2026-03-17T10:00:00Z"
}
```

### `POST /panel-configs/<config_id>/apply-panel/`

Used by: `api.updatePanelConfigFromPanel(config_id, body)`

Path parameters:

- `config_id`: string; required

Request body:

```json
{
  "panel_id": "pan_abcd1234",
  "mode": "overwrite",
  "fields": ["param_values", "queue_defaults"],
  "param_values": {
    "shots": 200
  },
  "queue_defaults": {
    "priority": 12,
    "schedule_type": "TIMED",
    "scheduled_at": "2026-03-18T09:00",
    "interval_min": null,
    "timezone": "Asia/Seoul",
    "recurrence": null
  }
}
```

Expected response:

```json
{
  "config_id": "pcfg_ab12cd",
  "updated_at": "2026-03-17T10:00:00Z",
  "updated_by": {
    "user_id": 1,
    "username": "admin"
  }
}
```

### `PATCH /panel-configs/<config_id>/`

Used by: `api.renamePanelConfig(config_id, title)`

Request body:

```json
{
  "title": "New Config Title"
}
```

Expected response:

```json
{
  "config_id": "pcfg_ab12cd",
  "updated_at": "2026-03-17T10:00:00Z",
  "updated_by": {
    "user_id": 1,
    "username": "admin"
  }
}
```

### `DELETE /panel-configs/<config_id>/`

Used by: `api.deletePanelConfig(config_id)`

Expected response:

- No body required by the frontend.

## Runs

### `POST /runs/`

Used by: `api.createRun(body)`

Important frontend behavior:

- if `param_values` is present and `arguments` is not, the client copies `param_values` into `arguments`
- the client only sends these keys:
  - `panel_id`
  - `script`
  - `script_path`
  - `arguments`
  - `user`
  - `status`
  - `priority`
  - `schedule_type`
  - `scheduled_at`
  - `interval_min`
  - `timezone`
  - `recurrence`
  - `name`

#### Immediate run example

```json
{
  "panel_id": "pan_abcd1234",
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "arguments": {
    "shots": 100,
    "detuning": 1.25
  },
  "priority": 20,
  "schedule_type": "NOW"
}
```

#### Timed run example

```json
{
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "arguments": {
    "shots": 100
  },
  "priority": 50,
  "schedule_type": "TIMED",
  "scheduled_at": "2026-03-18T09:00",
  "timezone": "Asia/Seoul"
}
```

#### Recurring interval example

```json
{
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "arguments": {
    "shots": 100
  },
  "priority": 100,
  "schedule_type": "RECURRING",
  "timezone": "Asia/Seoul",
  "recurrence": {
    "kind": "interval",
    "interval_min": 5,
    "start_immediately": true,
    "timezone": "Asia/Seoul"
  }
}
```

#### Recurring daily example

```json
{
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "arguments": {
    "shots": 100
  },
  "priority": 100,
  "schedule_type": "RECURRING",
  "timezone": "Asia/Seoul",
  "recurrence": {
    "kind": "daily",
    "time": "09:30",
    "every_n_days": 1,
    "timezone": "Asia/Seoul"
  }
}
```

#### Recurring weekly example

```json
{
  "script_path": "user_scripts/example.qil",
  "name": "CoolingScan",
  "arguments": {
    "shots": 100
  },
  "priority": 100,
  "schedule_type": "RECURRING",
  "timezone": "Asia/Seoul",
  "recurrence": {
    "kind": "weekly",
    "time": "09:30",
    "weekdays": [0, 2, 4],
    "every_n_weeks": 1,
    "timezone": "Asia/Seoul"
  }
}
```

Expected response:

- normalized run-like payload, at minimum containing:

```json
{
  "status": "QUEUED",
  "rid": 42
}
```

Recurring creation may also return:

```json
{
  "status": "SCHEDULED",
  "rid": 42,
  "schedule_id": "sch_a1b2c3d4e5"
}
```

### `GET /runs/<rid>/`

Used by: `api.getRun(rid)`

Path parameters:

- `rid`: integer; required

Expected response:

- run detail object normalized into `RunDetailResp`

### `POST /runs/<rid>/abort/`

Used by: `api.abortRun(rid)`

Path parameters:

- `rid`: integer; required

Request body:

```json
{}
```

Expected response:

```json
{
  "status": "Experiment aborted"
}
```

For recurring runs this also cancels the parent schedule and queued future occurrences.

### `DELETE /runs/<rid>/`

Used by: `api.deleteRun(rid)`

Path parameters:

- `rid`: integer; required

Expected response:

- No body required by the frontend.

## Datasets

### `GET /runs/<rid>/datasets/`

Used by: `api.listDatasets(rid)`

Path parameters:

- `rid`: integer; required

Expected response:

Either:

```json
[
  {
    "id": 3,
    "name": "Dataset_101500",
    "metadata": {}
  }
]
```

or:

```json
{
  "rid": 42,
  "datasets": [
    {
      "dataset_id": "ds_3",
      "name": "Dataset_101500",
      "dtype": "float32",
      "shape": [4, 101, 1],
      "updated_at": "2026-03-17T10:15:00Z"
    }
  ]
}
```

The frontend normalizes both shapes.

### `GET /runs/<rid>/datasets/<dataset_name>/meta/`

Used by: `api.getDatasetMeta(rid, dataset_name)`

Path parameters:

- `rid`: integer; required
- `dataset_name`: string; required

Expected response:

```json
{
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500",
  "dtype": "float32",
  "shape": [4, 101, 1],
  "metadata": {
    "param_axes": ["dummy_row"],
    "data_axes": ["row0", "row1", "row2", "row3"]
  }
}
```

The frontend also reads:

- `units`
- `parameters`
- `hints`

either at top level or under `metadata`.

### `GET /runs/<rid>/datasets/<dataset_name>/data/`

Used by: `api.getDatasetData(rid, dataset_name, opts?)`

Path parameters:

- `rid`: integer; required
- `dataset_name`: string; required

Query parameters used by the frontend:

- `format`: optional, usually `"json"`
- `slice`: optional

Expected response:

```json
{
  "rid": 42,
  "name": "Dataset_101500",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "data": [
    [0, 0, 1, 2, 100],
    [0, 1, 2, 3, 100]
  ]
}
```

`data` is intentionally loose in the frontend type and may be:

- array of rows
- scalar list
- object-like structures from older endpoints

The current frontend expects array-based datasets most often.

### `POST /runs/<rid>/datasets/<dataset_name>/query/`

Used by: `api.queryDataset(rid, dataset_name, body)`

Path parameters:

- `rid`: integer; required
- `dataset_name`: string; required

Request body:

```json
{
  "query": "GROUP BY dummy_row\nAGG avg(row1) AS avg_row1, count_if(row2 > 10) AS hits\nORDER BY dummy_row ASC",
  "slice": "optional"
}
```

Expected response:

```json
{
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500",
  "columns": ["dummy_row", "avg_row1", "hits"],
  "data": [
    [0, 10.5, 3],
    [1, 11.25, 4]
  ],
  "query": {
    "text": "GROUP BY dummy_row\nAGG avg(row1) AS avg_row1, count_if(row2 > 10) AS hits\nORDER BY dummy_row ASC",
    "grouped": true,
    "aggregated": true,
    "row_count": 2
  }
}
```

The returned payload is intentionally plot-ready: the frontend consumes it as another `columns + data(rows)` table.

## Logs

### `GET /runs/<rid>/logs/`

Used by: `api.getLogs(rid, from_seq?)`

Path parameters:

- `rid`: integer; required

Query parameters:

- `from_seq`: optional integer

Expected response:

```json
{
  "rid": 42,
  "items": [
    {
      "seq": 0,
      "ts": "2026-03-17T10:15:00Z",
      "level": "INFO",
      "msg": "Started"
    }
  ]
}
```

## TTL

### `GET /ttl/devices/`

Used by: `api.getTtlDevices()`

Expected response:

```json
{
  "devices": ["ttl0", "ttl1"]
}
```

### `POST /ttl/level/`

Used by: `api.setTtlLevel(devices, levels)`

Request body:

```json
{
  "devices": ["ttl0", "ttl1"],
  "levels": ["HIGH", "LOW"]
}
```

Expected response:

```json
{
  "ok": true
}
```

### `POST /ttl/override/`

Used by: `api.setTtlOverride(devices, values)`

Request body:

```json
{
  "devices": ["ttl0", "ttl1"],
  "values": [true, false]
}
```

Expected response:

```json
{
  "ok": true
}
```

## Archives

### `POST /archives/`

Used by: `api.createArchive(body)`

The frontend passes a free-form JSON object.
Common fields include:

```json
{
  "title": "Run 42 Archive",
  "experiment_run": 42,
  "datasets": ["Dataset_101500"],
  "tags": ["analysis"],
  "note": "optional"
}
```

Expected response:

```json
{
  "archive_id": 7,
  "created_at": "2026-03-17T10:20:00Z"
}
```

### `GET /archives/`

Used by: `api.listArchives(query?)`

Supported query parameters:

- arbitrary string map; depends on backend list implementation

Expected response:

```json
{
  "items": [
    {
      "archive_id": 7,
      "title": "Run 42 Archive",
      "rid": 42,
      "datasets": ["Dataset_101500"],
      "tags": ["analysis"],
      "note": "",
      "snapshot_mode": "",
      "author": {
        "user_id": 1,
        "username": "admin"
      },
      "created_at": "2026-03-17T10:20:00Z"
    }
  ],
  "next_cursor": null
}
```

### `GET /archives/<archive_id>/`

Used by: `api.getArchive(archive_id)`

Path parameters:

- `archive_id`: integer; required

Expected response:

```json
{
  "archive_id": 7,
  "title": "Run 42 Archive",
  "rid": 42,
  "datasets": ["Dataset_101500"],
  "tags": ["analysis"],
  "note": "",
  "snapshot_mode": "",
  "created_at": "2026-03-17T10:20:00Z"
}
```

### `PATCH /archives/<archive_id>/`

Used by: `api.updateArchive(archive_id, body)`

Request body:

- arbitrary partial archive object

Example:

```json
{
  "title": "Updated title",
  "tags": ["analysis", "approved"]
}
```

Expected response:

- updated archive detail

### `DELETE /archives/<archive_id>/`

Used by: `api.deleteArchive(archive_id)`

Expected response:

- No body required by the frontend.

### `GET /archives/<archive_id>/datasets/<dataset_name>/data/`

Used by: `api.getArchivedDatasetData(archive_id, dataset_name, opts?)`

Path parameters:

- `archive_id`: integer; required
- `dataset_name`: string; required

Query parameters:

- `format`: optional
- `slice`: optional

Expected response:

- same shape as run dataset data

### `POST /archives/<archive_id>/datasets/<dataset_name>/query/`

Used by: `api.queryArchivedDataset(archive_id, dataset_name, body)`

Path parameters:

- `archive_id`: integer; required
- `dataset_name`: string; required

Request body:

```json
{
  "query": "SELECT dummy_row, row0\nWHERE row0 > 5\nORDER BY dummy_row ASC",
  "slice": "optional"
}
```

Expected response:

- same shape as run dataset query

## WebSocket Endpoints

Websocket routes are not under `/api`; they are rooted directly from the server ASGI application.

### `GET WS /runs/stream/?token=<token>`

Used by: `RunsManagerView`

This is the current primary run-list interface used by the Experiment Manager.

Client subscription message:

```json
{
  "type": "subscribe",
  "filters": {
    "status": "QUEUED,RUNNING,COMPLETED",
    "limit": "50"
  }
}
```

Optional refresh message:

```json
{
  "op": "refresh"
}
```

Expected stream payload:

```json
{
  "type": "runs",
  "items": [/* run list */],
  "next_cursor": null,
  "updated_at": "2026-03-17T10:00:00Z"
}
```

### `GET WS /runs/<run_id>/datasets/<dataset_name>/stream/?token=<token>`

Used by: `DataViewerView`

Client message:

```json
{
  "mode": "rows",
  "period_ms": 200
}
```

Frontend expects the websocket stream to match the same row-table model as the HTTP dataset endpoint.

Initial snapshot:

```json
{
  "type": "snapshot",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "data": [
    [0, 0, 1, 2, 100],
    [1, 1, 2, 3, 100]
  ],
  "updated_at": "2026-03-17T10:00:00Z"
}
```

Append message:

```json
{
  "type": "append",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500",
  "columns": ["dummy_row", "row0", "row1", "row2", "row3"],
  "rows": [
    [2, 2, 3, 4, 100]
  ],
  "updated_at": "2026-03-17T10:00:00Z"
}
```

Optional reset:

```json
{
  "type": "reset",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500"
}
```

Optional error:

```json
{
  "type": "error",
  "rid": 42,
  "dataset_id": "ds_3",
  "name": "Dataset_101500",
  "message": "Dataset not found.",
  "updated_at": "2026-03-17T10:00:00Z"
}
```

### `GET WS /ttl/status/?token=<token>`

Used by: `TTLControlsView`

Optional client message:

```json
{
  "period_ms": 1000
}
```

Expected stream payload:

```json
{
  "type": "ttl_status",
  "items": [
    {
      "device": "ttl0",
      "level": "HIGH",
      "override": true,
      "value": true
    }
  ]
}
```
