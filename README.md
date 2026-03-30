# MAQPIE

`MAQPIE` is the React/Vite frontend for the MAQPIE server stack.
It talks to the Django backend over REST and WebSocket endpoints.

## Requirements

- Node.js `>=20.19` or `>=22.12`
- npm
- A running MAQPIE server backend at `http://localhost:8000/api` by default

## Installation

From the `iquip-web` directory:

```bash
npm install
```

## Running In Development

From `iquip-web`:

```bash
npm run dev
```

By default, the frontend expects the API base to be:

```text
http://localhost:8000/api
```

To point the frontend to a different MAQPIE server:

```bash
VITE_API_BASE=http://<host>:8000/api npm run dev
```

## Build

Create a production build with:

```bash
npm run build
```

Preview the built app locally with:

```bash
npm run preview
```

## How It Connects To The Server

The frontend uses two communication paths:

- REST API for login, runs, files, panels, datasets, archives, and TTL commands
- WebSockets for live run updates, dataset streaming, and TTL status updates

The REST base is resolved in this order:

1. `VITE_API_BASE`
2. `localStorage["api_base"]`
3. fallback: `http://localhost:8000/api`

WebSocket URLs are derived automatically from that API base in `src/lib/api.ts`.

## Project Structure

### App shell

- `src/main.tsx`
  - React entry point
  - mounts the app and provides the MUI theme
- `src/App.tsx`
  - top-level desktop shell
  - login screen
  - global launcher buttons
  - workspace strip
  - renders windows, minimized windows, and minimized panels
- `src/styles.css`
  - main visual styling for the desktop, windows, tabs, title bars, themes, and dock items

### State

- `src/state/store.ts`
  - window layout state
  - minimized panel state
  - active workspace tracking
  - toasts and persistence

### Components

- `src/components/Window.tsx`
  - draggable/resizable desktop window
  - tab strip
  - close/minimize/pop-out actions
- `src/components/ViewHost.tsx`
  - routes a stored tab entry to the correct React view
- `src/components/MinimizedPanelCard.tsx`
  - floating minimized panel widget
- `src/components/MinimizedWindowItem.tsx`
  - dock-style minimized window item

### Views

- `src/views/RunsManagerView.tsx`
  - experiment manager / run list
  - run actions and status stream
- `src/views/FileExplorerView.tsx`
  - server file browser for scripts / FPGA files
  - panel creation entry point for scripts
- `src/views/ExperimentPanelView.tsx`
  - experiment panel UI
  - parameter editing, scheduling, and queueing runs
- `src/views/DataViewerView.tsx`
  - dataset viewer
  - plotting, querying, streaming, archive creation, CSV download
- `src/views/ArchivesView.tsx`
  - archive list and archive opening/renaming/deletion
- `src/views/PanelConfigsView.tsx`
  - saved panel configuration snapshots
- `src/views/TTLControlsView.tsx`
  - TTL override / level control view

### Libraries

- `src/lib/api.ts`
  - all frontend API calls
  - auth header handling
  - websocket URL helpers
  - file download helpers
- `src/lib/types.ts`
  - shared frontend TypeScript types for API payloads and view state
- `src/lib/windowFrame.ts`
  - default window size/position presets
- `src/lib/workspaces.ts`
  - helper types/utilities for workspace metadata

### Config

- `src/config/fileExplorer.ts`
  - controls which file domains are exposed in the file explorer
  - sets default type, visible choices, root labels, and script extension filtering
- `src/config/panels.ts`
  - panel-related feature flags
  - for example whether class selection is enabled
- `src/config/workspace.ts`
  - top-level branding/workspace metadata such as team name and admin email

### Assets

- `src/assets/`
  - logos and static UI images

## Config Notes

### `src/config/fileExplorer.ts`

This file controls what the File Explorer shows.

Important fields:

- `defaultType`
  - initial file domain when the explorer opens
- `availableTypes`
  - which backend file domains are actually exposed in the UI
  - example: `['script']` or `['script', 'fpga']`
- `showTypeToggle`
  - whether the type selector should appear
  - it only shows when multiple `availableTypes` exist
- `allowedExtensions`
  - script-side filtering for visible files such as `['.qil']`
- `rootLabels`
  - display names for the root folder per file type

### `src/config/panels.ts`

This file controls panel-specific frontend behavior.
Right now it is mainly used for feature toggles such as class selection.

### `src/config/workspace.ts`

This file contains app-shell level metadata used in the UI, such as:

- team/workspace name
- admin/support email

## Common Commands

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Notes

- The UI expects authenticated MAQPIE server endpoints.
- Dataset downloads currently use the backend `download/` endpoints and return CSV.
- The project also includes internal docs in `docs/`, including:
  - `docs/FRONTEND_API_REFERENCE.md`
  - `docs/DATA_BACKEND_GUIDE.md`
