import { useEffect, useState } from "react";
import { Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { api } from "../lib/api";
import type { ArchiveItem } from "../lib/types";
import { useAppStore } from "../state/store";

export default function ArchivesView() {
  const showToast = useAppStore((s) => s.showToast);
  const addWindow = useAppStore((s) => s.addWindow);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState("");
  const [renameTarget, setRenameTarget] = useState<ArchiveItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [contextTarget, setContextTarget] = useState<ArchiveItem | null>(null);

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
    const win = {
      windowId: `win_${Math.random().toString(16).slice(2, 10)}`,
      x: 80,
      y: 80,
      w: 880,
      h: 620,
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
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between">
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Archives</Typography>
        <Button size="small" variant="outlined" disabled={loading} onClick={refresh}>Refresh</Button>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">Tag filter</Typography>
        <TextField size="small" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="paper" />
      </Stack>

      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>archive_id</TableCell>
            <TableCell>title</TableCell>
            <TableCell>rid</TableCell>
            <TableCell>datasets</TableCell>
            <TableCell>tags</TableCell>
            <TableCell>created</TableCell>
            <TableCell>open</TableCell>
            <TableCell>delete</TableCell>
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
              }}
            >
              <TableCell sx={{ fontFamily: "var(--mono)" }}>{a.archive_id}</TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{a.title}</Typography>
                {a.note && <Typography variant="caption" color="text.secondary">{a.note}</Typography>}
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
              <TableCell>
                <Button size="small" variant="outlined" onClick={() => openArchiveData(a)}>
                  Open
                </Button>
              </TableCell>
              <TableCell>
                <Button size="small" variant="outlined" color="error" onClick={() => deleteArchive(a)}>
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} sx={{ color: "text.secondary" }}>
                No archives.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={Boolean(contextTarget)} onClose={() => setContextTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Archive actions</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1, pt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {contextTarget ? `archive_id: ${contextTarget.archive_id}` : ""}
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
        <DialogTitle>Rename archive</DialogTitle>
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
