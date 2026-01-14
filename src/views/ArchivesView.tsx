import { useEffect, useState } from "react";
import { Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { api } from "../lib/api";
import type { ArchiveItem } from "../lib/types";
import { useAppStore } from "../state/store";

export default function ArchivesView() {
  const showToast = useAppStore((s) => s.showToast);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState("");

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
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((a) => (
            <TableRow key={a.archive_id} hover>
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
    </Paper>
  );
}
