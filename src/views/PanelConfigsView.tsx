import { useEffect, useState } from "react";
import { createWindowFrame } from "../lib/windowFrame";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { api } from "../lib/api";
import type { PanelConfigListItem } from "../lib/types";
import { useAppStore } from "../state/store";
import { panelOpenConfig } from "../config/panels";

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
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null);
  const [infoTarget, setInfoTarget] = useState<PanelConfigListItem | null>(null);
  const compactTableSx = {
    "& .MuiTableCell-root": { py: 0.55, px: 1, fontSize: 12, borderBottomColor: "var(--border)" },
    "& .MuiTableHead-root .MuiTableCell-root": {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: "var(--text)",
      backgroundColor: "var(--panel2)",
      borderBottomColor: "var(--border)",
    },
  };
  const compactFilterLabelSx = {
    transform: "translate(14px, 7px) scale(1)",
    "&.MuiInputLabel-shrink": {
      transform: "translate(14px, -9px) scale(0.75)",
    },
  };

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
        const frame = createWindowFrame("experimentPanel");
        const win = {
          windowId: uid("win"),
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
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
    <Paper
      variant="outlined"
      sx={{ p: 1, bgcolor: "background.paper", height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.75} sx={{ mb: 0.75 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Panel Configurations</Typography>
          <Typography variant="caption" color="text.secondary">Saved configuration snapshots</Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75} sx={{ mb: 0.75 }}>
        <TextField
          size="small"
          label="Tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          InputLabelProps={{ sx: compactFilterLabelSx }}
          sx={{
            minWidth: 100,
            "& .MuiInputBase-input": { py: "3px", fontSize: 11.5 },
          }}
        />
        <TextField
          size="small"
          label="Script path"
          value={scriptPath}
          onChange={(e) => setScriptPath(e.target.value)}
          InputLabelProps={{ sx: compactFilterLabelSx }}
          sx={{
            minWidth: 140,
            "& .MuiInputBase-input": { py: "3px", fontSize: 11.5 },
          }}
        />
        <TextField
          size="small"
          label="Class name"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          InputLabelProps={{ sx: compactFilterLabelSx }}
          sx={{
            minWidth: 120,
            "& .MuiInputBase-input": { py: "3px", fontSize: 11.5 },
          }}
        />
        <Button size="small" variant="contained" onClick={refresh} disabled={loading}>
          Apply
        </Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 3, flex: 1, minHeight: 0 }}>
          <CircularProgress size={20} />
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Table size="small" stickyHeader sx={{ ...compactTableSx, minWidth: 640 }}>
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Script</TableCell>
                {panelOpenConfig.enableClassSelection ? <TableCell>Class</TableCell> : null}
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
                    setContextAnchor({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <TableCell sx={{ minWidth: 170 }}>
                    <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: 700 }}>{c.title}</Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 270 }}>
                    <Typography variant="caption" sx={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>{c.script_path}</Typography>
                  </TableCell>
                  {panelOpenConfig.enableClassSelection ? (
                    <TableCell sx={{ minWidth: 140 }}>{c.class_name || "-"}</TableCell>
                  ) : null}
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={panelOpenConfig.enableClassSelection ? 3 : 2} sx={{ color: "text.secondary" }}>
                    No configs found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
        Right-click a config row for actions.
      </Typography>

      <Menu
        open={Boolean(contextTarget && contextAnchor)}
        onClose={() => {
          setContextTarget(null);
          setContextAnchor(null);
        }}
        MenuListProps={{ dense: true }}
        anchorReference="anchorPosition"
        anchorPosition={contextAnchor ? { top: contextAnchor.y, left: contextAnchor.x } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (!contextTarget) return;
            setInfoTarget(contextTarget);
            setContextTarget(null);
            setContextAnchor(null);
          }}
        >
          Info
        </MenuItem>
        <MenuItem
          onClick={async () => {
            if (!contextTarget) return;
            const configId = contextTarget.config_id;
            setContextTarget(null);
            setContextAnchor(null);
            await openPanelFromConfig(configId);
          }}
        >
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (contextTarget) openRename(contextTarget);
            setContextTarget(null);
            setContextAnchor(null);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={async () => {
            if (!contextTarget) return;
            const configId = contextTarget.config_id;
            setContextTarget(null);
            setContextAnchor(null);
            await deleteConfig(configId);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={Boolean(infoTarget)} onClose={() => setInfoTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1, borderBottom: "1px solid var(--border)" }}>Config info</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 0.5, pt: 1.25 }}>
          <Typography variant="caption">Title: {infoTarget?.title ?? "-"}</Typography>
          <Typography variant="caption" sx={{ fontFamily: "var(--mono)" }}>Config ID: {infoTarget?.config_id ?? "-"}</Typography>
          <Typography variant="caption" sx={{ fontFamily: "var(--mono)" }}>Script: {infoTarget?.script_path ?? "-"}</Typography>
          {panelOpenConfig.enableClassSelection ? (
            <Typography variant="caption">Class: {infoTarget?.class_name || "-"}</Typography>
          ) : null}
          <Typography variant="caption">Tags: {(infoTarget?.tags ?? []).join(", ") || "-"}</Typography>
          <Typography variant="caption">Updated: {infoTarget?.updated_at ? new Date(infoTarget.updated_at).toLocaleString() : "-"}</Typography>
          <Typography variant="caption">By: {infoTarget?.updated_by?.username ?? "-"}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInfoTarget(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1, borderBottom: "1px solid var(--border)" }}>Rename config</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1, pt: 1.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Configuration title
            </Typography>
            <TextField
              size="small"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Enter a new title"
              fullWidth
            />
          </Box>
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
