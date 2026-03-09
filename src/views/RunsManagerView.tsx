import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { api, normalizeRun, wsUrl } from "../lib/api";
import type { RunListItem, RunStatus } from "../lib/types";
import { useAppStore } from "../state/store";
import { panelOpenConfig } from "../config/panels";

function statusColor(s: RunStatus): "success" | "warning" | "error" | "info" {
  if (s === "RUNNING") return "info";
  if (s === "QUEUED") return "warning";
  if (s === "COMPLETED") return "success";
  return "error";
}

export default function RunsManagerView() {
  const showToast = useAppStore((s) => s.showToast);
  const windows = useAppStore((s) => s.windows);
  const addWindow = useAppStore((s) => s.addWindow);
  const addTabToWindow = useAppStore((s) => s.addTabToWindow);

  const [items, setItems] = useState<RunListItem[]>([]);
  const ALL_STATUSES: RunStatus[] = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "ABORTED"];
  const [selectedStatuses, setSelectedStatuses] = useState<RunStatus[]>(["QUEUED", "RUNNING", "COMPLETED", "FAILED"]);
  const [loading, setLoading] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [contextTarget, setContextTarget] = useState<RunListItem | null>(null);
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null);
  const [infoTarget, setInfoTarget] = useState<RunListItem | null>(null);
  const [wsNonce, setWsNonce] = useState(0);
  const lastStatusRef = useRef<Record<number, RunStatus>>({});

  function refresh() {
    setWsNonce((n) => n + 1);
  }

  useEffect(() => {
    setLoading(true);
    const status = selectedStatuses.length ? selectedStatuses.join(",") : "";
    const query: Record<string, string> = { limit: "50" };
    if (status) query.status = status;
    if (tagQuery.trim()) query.tag = tagQuery.trim();

    const ws = new WebSocket(wsUrl("/runs/stream/"));
    let closed = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", filters: query }));
    };
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data || "{}");
        if (data?.type !== "runs") return;
        let next = Array.isArray(data.items) ? data.items.map(normalizeRun) : [];
        const nextStatus: Record<number, RunStatus> = {};
        for (const r of next) {
          nextStatus[r.rid] = r.status;
          const prev = lastStatusRef.current[r.rid];
          if (prev && prev !== r.status && r.status === "FAILED") {
            showToast("Run failed", `rid=${r.rid} · ${r.name || r.script_path}`);
          }
        }
        lastStatusRef.current = nextStatus;
        if (tagQuery.trim()) {
          const q = tagQuery.trim().toLowerCase();
          next = next.filter((r: RunListItem) => (r.tags ?? []).some((t: string) => t.toLowerCase().includes(q)));
        }
        setItems(next);
      } finally {
        setLoading(false);
      }
    };
    ws.onerror = () => {
      if (!closed) showToast("Runs stream error", "WebSocket connection failed");
      setLoading(false);
    };
    ws.onclose = () => {
      closed = true;
      setLoading(false);
    };

    return () => {
      closed = true;
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatuses, tagQuery, wsNonce]);

  function openData(rid: number) {
    // Open a chooser tab: you pick dataset in the DataViewer itself
    const tab = {
      tabId: `tab_${Math.random().toString(16).slice(2, 10)}`,
      title: `Data: rid ${rid}`,
      view: "dataViewer" as const,
      props: { rid, datasetName: "" },
    };
    const target = windows.find((w) => !w.locked && !w.tabs.every((t) => t.view === "experimentPanel"));
    if (target) {
      addTabToWindow(target.windowId, tab, true);
    } else {
      const win = {
        windowId: `win_${Math.random().toString(16).slice(2, 10)}`,
        x: 160,
        y: 120,
        w: 700,
        h: 500,
        locked: false,
        tabs: [tab],
        activeTabId: tab.tabId,
      };
      addWindow(win);
    }
  }

  async function deleteRun(rid: number) {
    const ok = window.confirm(`Delete run ${rid}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.deleteRun(rid);
      showToast("Run deleted", `rid=${rid}`);
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Delete failed", msg);
    }
  }

  async function abortRun(r: RunListItem) {
    try {
      await api.abortRun(r.rid);
      showToast("Abort requested", `rid=${r.rid}`);
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Abort failed", msg);
    }
  }

  const countActive = useMemo(() => items.filter((x) => ["QUEUED", "RUNNING"].includes(x.status)).length, [items]);
  const compactTableSx = {
    mt: 0.75,
    "& .MuiTableCell-root": { py: 0.45, px: 0.8, fontSize: 12, borderBottomColor: "var(--border)" },
    "& .MuiTableHead-root .MuiTableCell-root": {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: "text.secondary",
    },
  };

  return (
    <Paper variant="outlined" sx={{ p: 1 }}>
      <Stack direction="row" alignItems="center" spacing={0.75} justifyContent="space-between">
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Current Runs</Typography>
          <Typography variant="caption" color="text.secondary">{countActive} active</Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={loading} onClick={refresh}>Refresh</Button>
      </Stack>

      <Box sx={{ mt: 0.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.25, display: "block" }}>
          Filter status
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {ALL_STATUSES.map((st) => {
            const checked = selectedStatuses.includes(st);
            return (
              <FormControlLabel
                key={st}
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    onChange={() => {
                      setSelectedStatuses((prev) =>
                        checked ? prev.filter((x) => x !== st) : [...prev, st]
                      );
                    }}
                  />
                }
                label={<Typography variant="caption">{st}</Typography>}
              />
            );
          })}
          <Button size="small" variant="outlined" onClick={() => setSelectedStatuses(["QUEUED", "RUNNING"])}>
            Active
          </Button>
          <Button size="small" variant="outlined" onClick={() => setSelectedStatuses([])}>
            All
          </Button>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75} alignItems={{ xs: "stretch", sm: "center" }} sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">Tag search</Typography>
          <TextField
            size="small"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="calib"
            sx={{ minWidth: 130 }}
          />
        </Stack>
      </Box>

      <Table size="small" sx={compactTableSx}>
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Experiment</TableCell>
            <TableCell>Script</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((r) => (
            <TableRow
              key={r.rid}
              hover
              onContextMenu={(e) => {
                e.preventDefault();
                setContextTarget(r);
                setContextAnchor({ x: e.clientX, y: e.clientY });
              }}
            >
              <TableCell>
                <Chip
                  size="small"
                  label={r.status}
                  color={statusColor(r.status)}
                  variant="outlined"
                  sx={{ height: 20, "& .MuiChip-label": { px: 0.7, fontSize: 11 } }}
                />
              </TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 12 }}>{r.name}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="caption" sx={{ fontFamily: "var(--mono)", fontSize: 11 }}>{r.script_path}</Typography>
                {panelOpenConfig.enableClassSelection && r.class_name ? (
                  <Typography variant="caption" color="text.secondary" display="block">{r.class_name}</Typography>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} sx={{ color: "text.secondary" }}>
                No runs.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
        Right-click a run row for actions.
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
          onClick={() => {
            if (!contextTarget) return;
            openData(contextTarget.rid);
            setContextTarget(null);
            setContextAnchor(null);
          }}
        >
          Open data
        </MenuItem>
        <MenuItem
          disabled={!contextTarget || ["COMPLETED", "FAILED", "CANCELLED", "ABORTED"].includes(contextTarget.status)}
          onClick={async () => {
            if (!contextTarget) return;
            const target = contextTarget;
            setContextTarget(null);
            setContextAnchor(null);
            await abortRun(target);
          }}
        >
          {contextTarget?.schedule_type === "RECURRING" ? "Stop schedule" : "Abort run"}
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          disabled={!contextTarget || !["COMPLETED", "FAILED", "CANCELLED", "ABORTED"].includes(contextTarget.status)}
          onClick={async () => {
            if (!contextTarget) return;
            const rid = contextTarget.rid;
            setContextTarget(null);
            setContextAnchor(null);
            await deleteRun(rid);
          }}
        >
          Delete run
        </MenuItem>
      </Menu>

      <Dialog open={Boolean(infoTarget)} onClose={() => setInfoTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1, borderBottom: "1px solid var(--border)" }}>Run info</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 0.5, pt: 1.25 }}>
          <Typography variant="caption">Name: {infoTarget?.name ?? "-"}</Typography>
          <Typography variant="caption">rid: {infoTarget?.rid ?? "-"}</Typography>
          <Typography variant="caption" sx={{ fontFamily: "var(--mono)" }}>Script: {infoTarget?.script_path ?? "-"}</Typography>
          {panelOpenConfig.enableClassSelection && infoTarget?.class_name ? (
            <Typography variant="caption">Class: {infoTarget.class_name}</Typography>
          ) : null}
          <Typography variant="caption">Status: {infoTarget?.status ?? "-"}</Typography>
          <Typography variant="caption">Schedule: {infoTarget?.schedule_type ?? "-"}</Typography>
          {infoTarget?.schedule_type === "TIMED" && infoTarget?.scheduled_at ? (
            <Typography variant="caption">Scheduled at: {new Date(infoTarget.scheduled_at).toLocaleString()}</Typography>
          ) : null}
          {infoTarget?.schedule_type === "RECURRING" && infoTarget?.interval_min ? (
            <Typography variant="caption">Interval: every {infoTarget.interval_min} min</Typography>
          ) : null}
          <Typography variant="caption">Tags: {(infoTarget?.tags ?? []).join(", ") || "-"}</Typography>
          <Typography variant="caption">Started: {infoTarget?.started_at ? new Date(infoTarget.started_at).toLocaleString() : "-"}</Typography>
          <Typography variant="caption">Created: {infoTarget?.created_at ? new Date(infoTarget.created_at).toLocaleString() : "-"}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInfoTarget(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        This view polls every 2s. Add WS fan-out later if you implement a consolidated stream server-side.
      </Typography>
    </Paper>
  );
}
