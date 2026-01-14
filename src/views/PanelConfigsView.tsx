import { useEffect, useState } from "react";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { api } from "../lib/api";
import type { PanelConfigListItem } from "../lib/types";
import { useAppStore } from "../state/store";

export default function PanelConfigsView() {
  const showToast = useAppStore((s) => s.showToast);
  const [items, setItems] = useState<PanelConfigListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tag, setTag] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [className, setClassName] = useState("");

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
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((c) => (
              <TableRow key={c.config_id} hover>
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
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: "text.secondary" }}>
                  No configs found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
