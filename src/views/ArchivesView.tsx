import { useEffect, useState } from "react";
import { createWindowFrame } from "../lib/windowFrame";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { api } from "../lib/api";
import type { ArchiveItem } from "../lib/types";
import { useAppStore } from "../state/store";

// Archives are immutable-ish data snapshots that reopen straight into the Data Viewer.
export default function ArchivesView() {
  const showToast = useAppStore((s) => s.showToast);
  const addWindow = useAppStore((s) => s.addWindow);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState("");
  const [renameTarget, setRenameTarget] = useState<ArchiveItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [contextTarget, setContextTarget] = useState<ArchiveItem | null>(null);
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null);
  const compactTableSx = {
    mt: 0.75,
    "& .MuiTableCell-root": { py: 0.45, px: 0.8, fontSize: 12, borderBottomColor: "var(--border)" },
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

  async function refresh() {
    setLoading(true);
    try {
      const resp = await api.listArchives(tag ? { tag, limit: "50" } : { limit: "50" });
      setItems(resp.items ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Archives error", msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  function openArchiveData(a: ArchiveItem) {
    const datasetName = a.datasets?.[0] ?? "";
    showToast("Opening archive", `archive_id=${a.archive_id}`);
    const tab = {
      tabId: `tab_${Math.random().toString(16).slice(2, 10)}`,
      title: `Archive ${a.archive_id}`,
      view: "dataViewer" as const,
      props: { rid: a.rid, datasetName, archiveId: a.archive_id },
    };
    const frame = createWindowFrame("dataViewer");
    const win = {
      windowId: `win_${Math.random().toString(16).slice(2, 10)}`,
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

  function openRename(a: ArchiveItem) {
    setRenameTarget(a);
    setRenameTitle(a.title || `Archive ${a.archive_id}`);
  }

  async function submitRename() {
    if (!renameTarget) return;
    try {
      await api.updateArchive(renameTarget.archive_id, { title: renameTitle });
      showToast("Archive renamed", renameTarget.archive_id.toString());
      setRenameTarget(null);
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Rename failed", msg);
    }
  }

  async function deleteArchive(a: ArchiveItem) {
    const ok = window.confirm(`Delete archive ${a.archive_id}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.deleteArchive(a.archive_id);
      showToast("Archive deleted", String(a.archive_id));
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Delete failed", msg);
    }
  }

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1, height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75} justifyContent="space-between">
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Archives</Typography>
        <Button size="small" variant="outlined" disabled={loading} onClick={refresh}>Refresh</Button>
      </Stack>

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.75 }}>
        <TextField
          size="small"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Tag"
          sx={{
            minWidth: 120,
            "& .MuiInputBase-input": { py: "3px", fontSize: 11.5 },
          }}
        />
      </Stack>

      <Box sx={{ mt: 0.5, flex: 1, minHeight: 0, overflow: "auto" }}>
        <Table size="small" stickyHeader sx={compactTableSx}>
          <TableHead>
            <TableRow>
              <TableCell>archive_id</TableCell>
              <TableCell>title</TableCell>
              <TableCell>rid</TableCell>
              <TableCell>datasets</TableCell>
              <TableCell>tags</TableCell>
              <TableCell>created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((a) => (
              <TableRow
                key={a.archive_id}
                hover
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextTarget(a);
                  setContextAnchor({ x: e.clientX, y: e.clientY });
                }}
              >
                <TableCell sx={{ fontFamily: "var(--mono)" }}>{a.archive_id}</TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 12 }}>{a.title}</Typography>
                  {a.note && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{a.note}</Typography>}
                </TableCell>
                <TableCell sx={{ fontFamily: "var(--mono)" }}>{a.rid}</TableCell>
                <TableCell>
                  <Typography variant="caption">{(a.datasets ?? []).join(", ")}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{(a.tags ?? []).join(", ")}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{new Date(a.created_at).toLocaleString()}</Typography>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: "text.secondary" }}>
                  No archives.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

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
            openArchiveData(contextTarget);
            setContextTarget(null);
            setContextAnchor(null);
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
            const target = contextTarget;
            setContextTarget(null);
            setContextAnchor(null);
            await deleteArchive(target);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1, borderBottom: "1px solid var(--border)" }}>Rename archive</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1, pt: 1.5 }}>
          <Box>
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
