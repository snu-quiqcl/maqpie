import { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography, Checkbox, FormControlLabel } from "@mui/material";
import { api } from "../lib/api";
import type { RunListItem, RunStatus } from "../lib/types";
import { useAppStore } from "../state/store";

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
  const ALL_STATUSES: RunStatus[] = ["QUEUED", "RUNNING", "COMPLETED"];
  const [selectedStatuses, setSelectedStatuses] = useState<RunStatus[]>(["QUEUED", "RUNNING", "COMPLETED"]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const status = selectedStatuses.length ? selectedStatuses.join(",") : "";
      const resp = await api.listRuns(status ? {status, limit: "50"} : {limit: "50"});
      setItems(resp.items ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Runs error", msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatuses]);

  function openData(rid: number) {
    // Open a chooser tab: you pick dataset in the DataViewer itself
    const tab = {
      tabId: `tab_${Math.random().toString(16).slice(2, 10)}`,
      title: `Data: rid ${rid}`,
      view: "dataViewer" as const,
      props: { rid, datasetName: "" },
    };
    const target = windows.find((w) => !w.locked);
    if (target) addTabToWindow(target.windowId, tab, true);
    else {
      const win = {
        windowId: `win_${Math.random().toString(16).slice(2, 10)}`,
        x: 160,
        y: 120,
        w: 880,
        h: 620,
        locked: false,
        tabs: [tab],
        activeTabId: tab.tabId,
      };
      addWindow(win);
    }
  }

  const countActive = useMemo(() => items.filter((x) => ["QUEUED", "RUNNING"].includes(x.status)).length, [items]);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between">
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Current Runs</Typography>
          <Typography variant="caption" color="text.secondary">{countActive} active</Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={loading} onClick={refresh}>Refresh</Button>
      </Stack>

      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
          Filter status
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
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
      </Box>

      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>rid</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Schedule</TableCell>
            <TableCell>Tags</TableCell>
            <TableCell>Start</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((r) => (
            <TableRow key={r.rid} hover>
              <TableCell>
                <Chip size="small" label={r.status} color={statusColor(r.status)} variant="outlined" />
              </TableCell>
              <TableCell sx={{ fontFamily: "var(--mono)" }}>{r.rid}</TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.name}</Typography>
                <Typography variant="caption" sx={{ fontFamily: "var(--mono)" }}>{r.script_path}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="caption">{r.schedule_type}</Typography>
                {r.schedule_type === "TIMED" && r.scheduled_at ? (
                  <Typography variant="caption" display="block">
                    {new Date(r.scheduled_at).toLocaleString()}
                  </Typography>
                ) : null}
                {r.schedule_type === "RECURRING" && r.interval_min ? (
                  <Typography variant="caption" display="block">
                    every {r.interval_min} min
                  </Typography>
                ) : null}
              </TableCell>
              <TableCell>
                <Typography variant="caption">{(r.tags ?? []).join(", ")}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="caption">{r.started_at ? new Date(r.started_at).toLocaleTimeString() : "-"}</Typography>
              </TableCell>
              <TableCell>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" onClick={() => openData(r.rid)}>
                    Data
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={async () => {
                      try {
                        await api.abortRun(r.rid);
                        showToast("Abort requested", `rid=${r.rid}`);
                        refresh();
                      } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String(e);
                        showToast("Abort failed", msg);
                      }
                    }}
                    disabled={["COMPLETED", "FAILED", "CANCELLED", "ABORTED"].includes(r.status)}
                    title={r.schedule_type === "RECURRING" ? "Stops the recurring schedule (backend must enforce)" : "Abort run"}
                  >
                    {r.schedule_type === "RECURRING" ? "Stop" : "Abort"}
                  </Button>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} sx={{ color: "text.secondary" }}>
                No runs.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        This view polls every 2s. Add WS fan-out later if you implement a consolidated stream server-side.
      </Typography>
    </Paper>
  );
}
