import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import Plot from "react-plotly.js";
import type { Data } from "plotly.js";
import { api, wsUrl } from "../lib/api";
import { useAppStore } from "../state/store";

type DatasetItem = {
  dataset_id?: string;
  name: string;
  dtype?: string;
  shape?: number[];
  updated_at?: string;
};

type DatasetMeta = {
  rid: number;
  dataset_id?: string;
  name: string;
  dtype?: string;
  shape?: number[];
  units?: Record<string, string>;
  parameters?: Record<string, any>;
  hints?: Record<string, any>;
};

type PatchMsg =
  | {
      rid: number;
      name: string;
      type: "append";
      points: Array<{ index: number; x: number; y: number[] | number }>;
      updated_at?: string;
    }
  | { rid: number; name: string; type: "reset" };

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type DataRow = Record<string, unknown> | unknown[] | number;

function buildArrayFields(data: unknown[]): string[] {
  let maxLen = 0;
  for (const row of data) {
    if (Array.isArray(row)) maxLen = Math.max(maxLen, row.length);
  }
  return Array.from({ length: maxLen }, (_, i) => `col${i}`);
}

function buildObjectFields(data: unknown[]): string[] {
  const set = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      set.add(key);
    }
  }
  return Array.from(set);
}

function getFieldValue(row: DataRow, field: string, index: number): number | null {
  if (field === "index") return index;
  if (Array.isArray(row)) {
    const match = field.match(/^col(\d+)$/);
    if (!match) return null;
    const idx = Number(match[1]);
    const val = row[idx];
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
  }
  if (row && typeof row === "object") {
    const val = (row as Record<string, unknown>)[field];
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
  }
  if (field === "value") {
    const num = Number(row);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export default function DataViewerView({ rid, datasetName, archiveId }: { rid: number; datasetName?: string; archiveId?: number }) {
  const showToast = useAppStore((s) => s.showToast);

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selected, setSelected] = useState<string>(datasetName ?? "");
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [plotMode, setPlotMode] = useState<"1d" | "2d">("1d");
  const [xField, setXField] = useState("");
  const [yField, setYField] = useState("");
  const [zField, setZField] = useState("");

  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTitle, setArchiveTitle] = useState("");
  const [archiveTags, setArchiveTags] = useState("");
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveDatasets, setArchiveDatasets] = useState<string[]>([]);

  // If you pass rid=0 (placeholder), show a helpful message.
  const ridValid = rid && rid > 0;
  const archiveMode = Boolean(archiveId);

  useEffect(() => {
    if (!ridValid || archiveMode) return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const resp = await api.listDatasets(rid);
        if (!mounted) return;

        const items = (resp?.datasets ?? []) as DatasetItem[];
        setDatasets(items);

        if (!selected && items.length > 0) {
          setSelected(items[0].name);
        }
      } catch (e: any) {
        showToast("Datasets load failed", e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);

  useEffect(() => {
    if (!archiveMode || !archiveId) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const a = await api.getArchive(archiveId);
        if (!mounted) return;
        const items = (a.datasets ?? []).map((name) => ({ name })) as DatasetItem[];
        setDatasets(items);
        if (!selected && items.length > 0) setSelected(items[0].name);
      } catch (e: any) {
        showToast("Archive load failed", e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveMode, archiveId]);

  useEffect(() => {
    if (!ridValid) return;
    if (!selected) return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);

        if (archiveMode && archiveId) {
          const a = await api.getArchive(archiveId);
          const d: any = await api.getArchivedDatasetData(archiveId, selected, { format: "json" });
          if (!mounted) return;
          setMeta({
            rid: a.rid,
            name: selected,
            dtype: "unknown",
            shape: [],
          });
          setData(d?.data ?? []);
        } else {
          const m: DatasetMeta = await api.getDatasetMeta(rid, selected);
          const d: any = await api.getDatasetData(rid, selected, { format: "json" });
          if (!mounted) return;
          setMeta(m);
          setData(d?.data ?? []);
        }

      } catch (e: any) {
        showToast("Dataset load failed", e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [rid, ridValid, selected, showToast, archiveMode, archiveId]);

  // Streaming WS
  useEffect(() => {
    if (!ridValid || archiveMode) return;
    if (!selected) return;

    if (!streaming) {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
      wsRef.current = null;
      return;
    }

    const url = wsUrl(`/runs/${rid}/datasets/${encodeURIComponent(selected)}/stream/`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ mode: "patch", period_ms: 200 }));
      showToast("Streaming", `Subscribed to ${selected}`);
    };

    ws.onmessage = (ev) => {
      const msg = safeJsonParse<PatchMsg>(ev.data);
      if (!msg) return;

      if (msg.type === "reset") {
        setData([]);
        return;
      }

      if (msg.type === "append") {
        setData((prev) => {
          // append patches as rows; you can do smarter indexing later
          const next = prev.slice();
          for (const p of msg.points) {
            next.push([p.x, p.y]);
          }
          return next;
        });
      }
    };

    ws.onerror = () => {
      showToast("Streaming error", "WebSocket error (check token / backend WS route).");
    };

    ws.onclose = () => {
      // no toast spam
    };

    return () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [rid, ridValid, selected, streaming, showToast, archiveMode]);

  const fieldOptions = useMemo(() => {
    const base: string[] = ["index"];
    if (!data || data.length === 0) {
      const metaFields = meta?.parameters ? Object.keys(meta.parameters) : [];
      return Array.from(new Set([...base, ...metaFields]));
    }
    const first = data[0];
    const dataFields = Array.isArray(first)
      ? buildArrayFields(data)
      : typeof first === "object" && first !== null
      ? buildObjectFields(data)
      : ["value"];
    const metaFields = meta?.parameters ? Object.keys(meta.parameters) : [];
    return Array.from(new Set([...base, ...dataFields, ...metaFields]));
  }, [data, meta]);

  useEffect(() => {
    if (fieldOptions.length === 0) return;
    if (!xField || !fieldOptions.includes(xField)) setXField(fieldOptions[0]);
    if (!yField || !fieldOptions.includes(yField)) setYField(fieldOptions[1] ?? fieldOptions[0]);
    if (!zField || !fieldOptions.includes(zField)) setZField(fieldOptions[2] ?? fieldOptions[1] ?? fieldOptions[0]);
  }, [fieldOptions, xField, yField, zField]);

  const plotTrace = useMemo<Data[]>(() => {
    if (!data || data.length === 0) return [];
    const x: number[] = [];
    const y: number[] = [];
    const z: number[] = [];

    data.forEach((row, idx) => {
      const xVal = getFieldValue(row as DataRow, xField, idx);
      const yVal = getFieldValue(row as DataRow, yField, idx);
      const zVal = getFieldValue(row as DataRow, zField, idx);
      if (plotMode === "1d") {
        if (yVal === null) return;
        x.push(xVal ?? idx);
        y.push(yVal);
        return;
      }
      if (xVal === null || yVal === null || zVal === null) return;
      x.push(xVal);
      y.push(yVal);
      z.push(zVal);
    });

    if (plotMode === "1d") {
      return [
        {
          x,
          y,
          type: "scattergl",
          mode: "lines+markers",
          marker: { size: 4, color: "#6cb6ff" },
          line: { width: 1.5, color: "#6cb6ff" },
        } as Data,
      ];
    }

    return [
      {
        x,
        y,
        type: "scattergl",
        mode: "markers",
        marker: {
          size: 6,
          color: z,
          colorscale: "Viridis",
          showscale: true,
        },
      } as Data,
    ];
  }, [data, plotMode, xField, yField, zField]);

  if (!ridValid) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Data Viewer</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          Select a run (rid) from the Experiment Manager, then open a Data Viewer tab for that run.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {archiveMode ? `Archive ${archiveId}` : `Run ${rid}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">{archiveMode ? "Archived dataset" : "Dataset viewer"}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {!archiveMode && (
            <FormControlLabel
              control={<Checkbox size="small" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />}
              label={<Typography variant="caption">Streaming</Typography>}
            />
          )}
          {!archiveMode && (
            <Button
              size="small"
              variant="outlined"
              onClick={async () => {
                if (!selected) return;
                try {
                  setLoading(true);
                  const d: any = await api.getDatasetData(rid, selected, { format: "json" });
                  setData(d?.data ?? []);
                } catch (e: any) {
                  showToast("Refresh failed", e.message || String(e));
                } finally {
                  setLoading(false);
                }
              }}
              disabled={!selected || loading}
            >
              Refresh snapshot
            </Button>
          )}
          {!archiveMode && (
            <Button size="small" variant="outlined" onClick={() => {
              setArchiveTitle(`Run ${rid} Archive`);
              setArchiveDatasets(datasets.map((d) => d.name));
              setArchiveOpen(true);
            }}>
              Archive
            </Button>
          )}
        </Stack>
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 1.5, mt: 1.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            Datasets
          </Typography>
          <Select
            size="small"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            fullWidth
            disabled={datasets.length === 0}
          >
            {datasets.map((d) => (
              <MenuItem key={d.name} value={d.name}>
                {d.name}
              </MenuItem>
            ))}
          </Select>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: "block" }}>
            Plot mode
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={plotMode}
            onChange={(_, next) => next && setPlotMode(next)}
            sx={{ mt: 0.5 }}
          >
            <ToggleButton value="1d">1D</ToggleButton>
            <ToggleButton value="2d">2D</ToggleButton>
          </ToggleButtonGroup>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: "block" }}>
            Axes
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 0.5 }}>
            <Select size="small" value={xField} onChange={(e) => setXField(e.target.value)} fullWidth>
              {fieldOptions.map((f) => (
                <MenuItem key={f} value={f}>
                  X: {f}
                </MenuItem>
              ))}
            </Select>
            <Select size="small" value={yField} onChange={(e) => setYField(e.target.value)} fullWidth>
              {fieldOptions.map((f) => (
                <MenuItem key={f} value={f}>
                  Y: {f}
                </MenuItem>
              ))}
            </Select>
            {plotMode === "2d" && (
              <Select size="small" value={zField} onChange={(e) => setZField(e.target.value)} fullWidth>
                {fieldOptions.map((f) => (
                  <MenuItem key={f} value={f}>
                    Z: {f}
                  </MenuItem>
                ))}
              </Select>
            )}
          </Stack>

          <Box sx={{ mt: 1.25 }}>
            <Typography variant="caption" color="text.secondary">
              Select axes to explore parameters.
            </Typography>
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            Live plot
          </Typography>
          <Typography variant="caption" color="text.secondary">
            rows: {Array.isArray(data) ? data.length : 0} · x: {xField || "?"} · y: {yField || "?"}
            {plotMode === "2d" ? ` · z: ${zField || "?"}` : ""}
          </Typography>
          <Box sx={{ mt: 0.75, height: 360 }}>
            <Plot
              data={plotTrace}
              layout={{
                autosize: true,
                margin: { l: 48, r: 16, t: 24, b: 40 },
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { color: "#cdd6df" },
                xaxis: { title: xField || "x" },
                yaxis: { title: yField || "y" },
              }}
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
              config={{ responsive: true, displayModeBar: false }}
            />
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            The plot updates live from streaming patches.
          </Typography>
        </Box>
      </Box>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create archive</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.25, pt: 1 }}>
          <TextField
            label="Title"
            size="small"
            value={archiveTitle}
            onChange={(e) => setArchiveTitle(e.target.value)}
          />
          <TextField
            label="Tags (CSV)"
            size="small"
            value={archiveTags}
            onChange={(e) => setArchiveTags(e.target.value)}
          />
          <TextField
            label="Note"
            size="small"
            value={archiveNote}
            onChange={(e) => setArchiveNote(e.target.value)}
            multiline
            minRows={2}
          />
          <Box>
            <Typography variant="caption" color="text.secondary">Datasets</Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {datasets.map((d) => {
                const checked = archiveDatasets.includes(d.name);
                return (
                  <FormControlLabel
                    key={d.name}
                    control={
                      <Checkbox
                        size="small"
                        checked={checked}
                        onChange={() => {
                          setArchiveDatasets((prev) =>
                            checked ? prev.filter((x) => x !== d.name) : [...prev, d.name]
                          );
                        }}
                      />
                    }
                    label={<Typography variant="caption">{d.name}</Typography>}
                  />
                );
              })}
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              try {
                const tags = archiveTags.split(",").map((t) => t.trim()).filter(Boolean);
                const body = {
                  rid,
                  title: archiveTitle || `Run ${rid} Archive`,
                  datasets: archiveDatasets,
                  tags,
                  note: archiveNote,
                  snapshot_mode: "reference",
                };
                const resp = await api.createArchive(body);
                showToast("Archive created", `archive_id=${resp.archive_id}`);
                setArchiveOpen(false);
              } catch (e: any) {
                showToast("Archive failed", e.message || String(e));
              }
            }}
            disabled={archiveDatasets.length === 0}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
