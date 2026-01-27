import { useEffect, useState } from "react";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { api } from "../lib/api";
import type { PanelConfigListItem } from "../lib/types";
import { useAppStore } from "../state/store";

export default function PanelConfigsView() {
  const showToast = useAppStore((s) => s.showToast);
  const windows = useAppStore((s) => s.windows);
  const addWindow = useAppStore((s) => s.addWindow);
  const addTabToWindow = useAppStore((s) => s.addTabToWindow);
  const bringToFront = useAppStore((s) => s.bringToFront);
  const [items, setItems] = useState<PanelConfigListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [className, setClassName] = useState("");
  const [renameTarget, setRenameTarget] = useState<PanelConfigListItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [contextTarget, setContextTarget] = useState<PanelConfigListItem | null>(null);

  function uid(prefix: string) {
    return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
  }

  async function openPanelFromConfig(configId: string) {
    try {
      const panel = await api.openPanelFromConfig(configId);
      const tab = { tabId: uid("tab"), title: `Panel: ${panel.name}`, view: "experimentPanel" as const, props: { panelId: panel.panel_id } };

      const target = windows.find((w) => !w.locked && w.tabs.every((t) => t.view === "experimentPanel"));
      if (target) {
        addTabToWindow(target.windowId, tab, true);
        bringToFront(target.windowId);
      } else {
        const win = {
          windowId: uid("win"),
          x: 140,
          y: 140,
          w: 680,
          h: 560,
          locked: false,
          tabs: [tab],
          activeTabId: tab.tabId,
        };
        addWindow(win);
      }

      showToast("Panel opened", panel.panel_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Open panel failed", msg);
    }
  }

  async function deleteConfig(configId: string) {
    const ok = window.confirm(`Delete config ${configId}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.deletePanelConfig(configId);
      showToast("Config deleted", configId);
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Delete config failed", msg);
    }
  }

  function openRename(c: PanelConfigListItem) {
    setRenameTarget(c);
    setRenameTitle(c.title || c.config_id);
  }

  async function submitRename() {
    if (!renameTarget) return;
    try {
      await api.renamePanelConfig(renameTarget.config_id, renameTitle);
      showToast("Config renamed", renameTarget.config_id);
      setRenameTarget(null);
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Rename failed", msg);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const query: Record<string, string> = {};
      if (tag) query.tag = tag;
      if (scriptPath) query.script_path = scriptPath;
      if (className) query.class_name = className;
      const resp = await api.listPanelConfigs(query);
      setItems(resp.items ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Panel configs error", msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "background.paper" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Panel Configurations</Typography>
          <Typography variant="caption" color="text.secondary">Saved configuration snapshots</Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1 }}>
        <TextField
          size="small"
          label="Tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <TextField
          size="small"
          label="Script path"
          value={scriptPath}
          onChange={(e) => setScriptPath(e.target.value)}
        />
        <TextField
          size="small"
          label="Class name"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
        />
        <Button size="small" variant="contained" onClick={refresh} disabled={loading}>
          Apply
        </Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Config ID</TableCell>
              <TableCell>Script</TableCell>
              <TableCell>Class</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell>By</TableCell>
              <TableCell>Open</TableCell>
              <TableCell>Delete</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((c) => (
              <TableRow
                key={c.config_id}
                hover
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextTarget(c);
                }}
              >
                <TableCell>{c.title}</TableCell>
                <TableCell sx={{ fontFamily: "var(--mono)" }}>{c.config_id}</TableCell>
                <TableCell>{c.script_path}</TableCell>
                <TableCell>{c.class_name}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                    {(c.tags ?? []).map((t) => (
                      <Chip key={t} label={t} size="small" variant="outlined" />
                    ))}
                  </Stack>
                </TableCell>
                <TableCell>{c.updated_at ? new Date(c.updated_at).toLocaleString() : "-"}</TableCell>
                <TableCell>{c.updated_by?.username ?? "-"}</TableCell>
                <TableCell>
                  <Button size="small" variant="contained" onClick={() => openPanelFromConfig(c.config_id)}>
                    Open
                  </Button>
                </TableCell>
                <TableCell>
                  <Button size="small" variant="outlined" color="error" onClick={() => deleteConfig(c.config_id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ color: "text.secondary" }}>
                  No configs found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={Boolean(contextTarget)} onClose={() => setContextTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Config actions</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1, pt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {contextTarget ? `config_id: ${contextTarget.config_id}` : ""}
          </Typography>
          <Button variant="outlined" onClick={() => { if (contextTarget) openRename(contextTarget); setContextTarget(null); }}>
            Rename
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContextTarget(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename config</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1, pt: 1 }}>
          <TextField
            size="small"
            label="Title"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitRename} disabled={!renameTitle.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
