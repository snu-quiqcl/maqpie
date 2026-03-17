import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Collapse,
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
  Divider,
} from "@mui/material";
import Plot from "react-plotly.js";
import type { Data as PlotData } from "plotly.js";
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
  metadata?: Record<string, any>;
};

type PatchMsg =
  | {
      rid: number;
      name: string;
      dataset_id?: string;
      type: "snapshot";
      columns: string[];
      data: unknown[];
      updated_at?: string;
    }
  | {
      rid: number;
      name: string;
      dataset_id?: string;
      type: "append";
      columns: string[];
      rows: unknown[];
      updated_at?: string;
    }
  | { rid: number; name?: string; dataset_id?: string; type: "reset" }
  | { rid: number; name?: string; dataset_id?: string; type: "error"; message?: string; updated_at?: string };
type AggMode = "none" | "sum" | "average" | "threshold";

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

function getFieldValue(row: DataRow, field: string, index: number, arrayColumns?: string[]): number | null {
  if (field === "index") return index;
  if (Array.isArray(row)) {
    let idx = -1;
    if (arrayColumns && arrayColumns.length > 0) idx = arrayColumns.indexOf(field);
    if (idx < 0) {
      const match = field.match(/^col(\d+)$/);
      if (!match) return null;
      idx = Number(match[1]);
    }
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

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => String(x));
}

function toNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function aggregate(values: number[], mode: AggMode, threshold: number): number | null {
  if (values.length === 0) return null;
  if (mode === "sum") return values.reduce((a, b) => a + b, 0);
  if (mode === "average") return values.reduce((a, b) => a + b, 0) / values.length;
  if (mode === "threshold") return values.filter((v) => v > threshold).length;
  return null;
}

function extractScalarValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(raw) && raw.length === 1) {
    return extractScalarValue(raw[0]);
  }
  if (raw && typeof raw === "object") {
    const value = (raw as Record<string, unknown>).value;
    return extractScalarValue(value);
  }
  return null;
}

export default function DataViewerView({ rid, datasetName, archiveId }: { rid: number; datasetName?: string; archiveId?: number }) {
  const showToast = useAppStore((s) => s.showToast);

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selected, setSelected] = useState<string>(datasetName ?? "");
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [plotMode, setPlotMode] = useState<"1d" | "2d">("1d");
  const [xField, setXField] = useState("");
  const [yField, setYField] = useState("");
  const [zField, setZField] = useState("");
  const [xAgg, setXAgg] = useState<AggMode>("none");
  const [yAgg, setYAgg] = useState<AggMode>("none");
  const [zAgg, setZAgg] = useState<AggMode>("none");
  const [xAggField, setXAggField] = useState("");
  const [yAggField, setYAggField] = useState("");
  const [zAggField, setZAggField] = useState("");
  const [xThreshold, setXThreshold] = useState("0");
  const [yThreshold, setYThreshold] = useState("0");
  const [zThreshold, setZThreshold] = useState("0");
  const [selectedVariable, setSelectedVariable] = useState("");
  const [selectedDataColumn, setSelectedDataColumn] = useState("");
  const [queryText, setQueryText] = useState("");
  const [queryActive, setQueryActive] = useState(false);
  const [querySummary, setQuerySummary] = useState<string>("");
  const [queryOpen, setQueryOpen] = useState(false);

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
        if (items.length === 0) {
          setMeta(null);
          setData([]);
          showToast("No datasets", "This run has no datasets yet.");
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
        if (items.length === 0) {
          setMeta(null);
          setData([]);
          showToast("No datasets", "This archive has no datasets.");
        }
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
          setColumns(Array.isArray(d?.columns) ? d.columns : []);
          setData(d?.data ?? []);
          setQueryActive(false);
          setQuerySummary("");
        } else {
          const m: DatasetMeta = await api.getDatasetMeta(rid, selected);
          const d: any = await api.getDatasetData(rid, selected, { format: "json" });
          if (!mounted) return;
          setMeta(m);
          setColumns(Array.isArray(d?.columns) ? d.columns : []);
          setData(d?.data ?? []);
          setQueryActive(false);
          setQuerySummary("");
        }

        if (!mounted) return;

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

  const schemaParamAxes = useMemo(() => asStringList(meta?.metadata?.param_axes), [meta]);
  const schemaDataAxes = useMemo(() => asStringList(meta?.metadata?.data_axes), [meta]);
  const inferredMatrixShape = useMemo(() => {
    const fromMeta = Array.isArray(meta?.shape) ? meta?.shape.map((v) => Number(v)) : [];
    const metaRows = fromMeta.length >= 2 && Number.isFinite(fromMeta[0]) ? Math.max(0, Math.trunc(fromMeta[0])) : 0;
    const metaCols = fromMeta.length >= 2 && Number.isFinite(fromMeta[1]) ? Math.max(0, Math.trunc(fromMeta[1])) : 0;
    const is2DArray = Array.isArray(data) && data.length > 0 && data.every((r) => Array.isArray(r));
    const dataRows = is2DArray ? data.length : 0;
    const dataCols = is2DArray ? Math.max(...(data as unknown[][]).map((r) => r.length), 0) : 0;

    const rows = metaRows > 0 ? metaRows : dataRows;
    const cols = metaCols > 0 ? metaCols : dataCols;
    const matrixRowMode = rows > 0 && cols > 0 && rows <= 32 && cols > rows;
    return { rows, cols, matrixRowMode };
  }, [meta, data]);
  const schemaDataAxesEffective = useMemo(() => {
    const explicit = asStringList(meta?.metadata?.data_axes_effective);
    if (explicit.length > 0) return explicit;
    const fromDataAxes = schemaDataAxes.filter((name) => name !== "_");
    if (fromDataAxes.length > 0) return fromDataAxes;
    if (inferredMatrixShape.matrixRowMode) {
      return Array.from({ length: inferredMatrixShape.rows }, (_, i) => `row${i}`);
    }
    return [];
  }, [meta, schemaDataAxes, inferredMatrixShape]);
  const schemaMode = columns.length === 0 && schemaDataAxesEffective.length > 0;
  const explicitDatasetType = String(meta?.metadata?.dataset_type ?? meta?.hints?.dataset_type ?? "").toLowerCase();
  const scalarValue = useMemo(() => extractScalarValue(data), [data]);
  const scalarMode = explicitDatasetType === "scalar" || (columns.length === 0 && scalarValue !== null);
  const sectionSx = {
    mt: 1,
    p: 0.9,
    border: "1px solid var(--border)",
    borderRadius: 1,
    background: "color-mix(in srgb, var(--panel2) 72%, transparent)",
  } as const;
  const sectionTitleSx = { display: "block", mb: 0.5, letterSpacing: "0.02em" } as const;

  useEffect(() => {
    const varOpts = schemaParamAxes.length > 0 ? schemaParamAxes : ["index"];
    if (!selectedVariable || !varOpts.includes(selectedVariable)) {
      setSelectedVariable(varOpts[0]);
    }
    if (!selectedDataColumn || !schemaDataAxesEffective.includes(selectedDataColumn)) {
      setSelectedDataColumn(schemaDataAxesEffective[0] ?? "");
    }
  }, [schemaParamAxes, schemaDataAxesEffective, selectedVariable, selectedDataColumn]);

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
      ws.send(JSON.stringify({ mode: "rows", period_ms: 200 }));
      showToast("Streaming", `Subscribed to ${selected}`);
    };

    ws.onmessage = (ev) => {
      const msg = safeJsonParse<PatchMsg>(ev.data);
      if (!msg) return;

      if (msg.type === "error") {
        showToast("Streaming error", msg.message || "Dataset stream failed.");
        return;
      }

      if (msg.type === "reset") {
        setData([]);
        return;
      }

      if (msg.type === "snapshot") {
        setColumns(Array.isArray(msg.columns) ? msg.columns : []);
        setData(Array.isArray(msg.data) ? msg.data : []);
        return;
      }

      if (msg.type === "append") {
        if (Array.isArray(msg.columns) && msg.columns.length > 0) {
          setColumns(msg.columns);
        }
        setData((prev) => {
          const nextRows = Array.isArray(msg.rows) ? msg.rows : [];
          return prev.concat(nextRows);
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
    if (scalarMode) return ["value"];
    if (columns.length > 0) return columns;
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
  }, [data, meta, columns, scalarMode]);

  useEffect(() => {
    if (fieldOptions.length === 0) return;
    if (!xField || !fieldOptions.includes(xField)) setXField(fieldOptions[0]);
    if (!yField || !fieldOptions.includes(yField)) setYField(fieldOptions[1] ?? fieldOptions[0]);
    if (!zField || !fieldOptions.includes(zField)) setZField(fieldOptions[2] ?? fieldOptions[1] ?? fieldOptions[0]);
    if (!xAggField || !fieldOptions.includes(xAggField)) setXAggField(fieldOptions[1] ?? fieldOptions[0]);
    if (!yAggField || !fieldOptions.includes(yAggField)) setYAggField(fieldOptions[0]);
    if (!zAggField || !fieldOptions.includes(zAggField)) setZAggField(fieldOptions[0]);
  }, [fieldOptions, xField, yField, zField]);

  const plotTrace = useMemo<PlotData[]>(() => {
    if (!data || data.length === 0) return [];

    if (schemaMode) {
      const rows = Array.isArray(data) ? data : [];
      const fullAxes =
        schemaDataAxes.length > 0
          ? schemaDataAxes
          : (schemaDataAxesEffective.length > 0 ? schemaDataAxesEffective : []);
      const label = selectedDataColumn || schemaDataAxesEffective[0];
      const rowIdx = Math.max(0, fullAxes.indexOf(label));
      const row = rows[rowIdx];

      // Expected primary format: R x N (single save) -> selected row as 1D series.
      // For R x N x S payloads, pick the first save index for now.
      let y: number[] = [];
      if (Array.isArray(row) && row.length > 0 && Array.isArray(row[0])) {
        y = (row as unknown[]).map((cell) => {
          const first = Array.isArray(cell) ? cell[0] : cell;
          const n = Number(first);
          return Number.isFinite(n) ? n : NaN;
        }).filter((n) => Number.isFinite(n));
      } else {
        y = toNumberArray(row);
      }
      const x = y.map((_, i) => i);

      return [
        {
          x,
          y,
          type: "scattergl" as const,
          mode: "lines+markers" as const,
          marker: { size: 4, color: "#6cb6ff" },
          line: { width: 1.5, color: "#6cb6ff" },
          name: label || "data",
        },
      ];
    }

    const rows = Array.isArray(data) ? data : [];
    const points = rows.map((row, idx) => {
      const xVal = getFieldValue(row as DataRow, xField, idx, columns);
      const yVal = getFieldValue(row as DataRow, yField, idx, columns);
      const zVal = getFieldValue(row as DataRow, zField, idx, columns);
      return { row, idx, x: xVal, y: yVal, z: zVal };
    });

    let xyPoints = points.filter((p) => p.x !== null && p.y !== null) as Array<{ row: any; idx: number; x: number; y: number; z: number | null }>;
    let xyzPoints = points.filter((p) => p.x !== null && p.y !== null && p.z !== null) as Array<{ row: any; idx: number; x: number; y: number; z: number }>;

    const applyAxisAgg = (
      src: Array<{ row: any; idx: number; x: number; y: number; z: number | null }>,
      groupAxis: "x" | "y",
      mode: AggMode,
      valueField: string,
      thresholdRaw: string
    ) => {
      if (mode === "none") return src;
      const thr = Number(thresholdRaw);
      const threshold = Number.isFinite(thr) ? thr : 0;
      const groups = new Map<number, number[]>();
      for (const p of src) {
        const key = groupAxis === "x" ? p.x : p.y;
        const m = getFieldValue(p.row as DataRow, valueField, p.idx, columns);
        if (m === null) continue;
        const arr = groups.get(key) ?? [];
        arr.push(m);
        groups.set(key, arr);
      }
      const out: Array<{ row: any; idx: number; x: number; y: number; z: number | null }> = [];
      const keys = Array.from(groups.keys()).sort((a, b) => a - b);
      for (const key of keys) {
        const agg = aggregate(groups.get(key) ?? [], mode, threshold);
        if (agg === null) continue;
        if (groupAxis === "x") out.push({ row: null, idx: 0, x: key, y: agg, z: null });
        else out.push({ row: null, idx: 0, x: agg, y: key, z: null });
      }
      return out;
    };

    xyPoints = applyAxisAgg(xyPoints, "x", xAgg, xAggField, xThreshold);
    xyPoints = applyAxisAgg(xyPoints, "y", yAgg, yAggField, yThreshold);

    if (plotMode === "2d") {
      if (zAgg !== "none") {
        const thr = Number(zThreshold);
        const threshold = Number.isFinite(thr) ? thr : 0;
        const vals: number[] = [];
        for (const p of xyzPoints) {
          const m = getFieldValue(p.row as DataRow, zAggField, p.idx, columns);
          if (m !== null) vals.push(m);
        }
        const aggZ = aggregate(vals, zAgg, threshold);
        if (aggZ !== null) {
          xyzPoints = xyzPoints.map((p) => ({ ...p, z: aggZ }));
        }
      }
    }

    const x = plotMode === "2d" ? xyzPoints.map((p) => p.x) : xyPoints.map((p) => p.x);
    const y = plotMode === "2d" ? xyzPoints.map((p) => p.y) : xyPoints.map((p) => p.y);
    const z = xyzPoints.map((p) => p.z as number);

    if (plotMode === "1d") {
      return [
        {
          x,
          y,
          type: "scattergl" as const,
          mode: "lines+markers" as const,
          marker: { size: 4, color: "#6cb6ff" },
          line: { width: 1.5, color: "#6cb6ff" },
        },
      ];
    }

    return [
      {
        x,
        y,
        type: "scattergl" as const,
        mode: "markers" as const,
        marker: {
          size: 6,
          color: z,
          colorscale: "Viridis",
          showscale: true,
        },
      },
    ];
  }, [
    data, plotMode, xField, yField, zField, schemaMode, schemaDataAxes, schemaDataAxesEffective, selectedDataColumn, columns,
    xAgg, yAgg, zAgg, xAggField, yAggField, zAggField, xThreshold, yThreshold, zThreshold
  ]);

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

  if (scalarMode) {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Stack spacing={1}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {archiveMode ? `Archive ${archiveId}` : `Run ${rid}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {selected || meta?.name || "Scalar dataset"}
            </Typography>
          </Box>
          <Box
            sx={{
              minHeight: 140,
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--border)",
              borderRadius: 1,
              background: "color-mix(in srgb, var(--panel2) 78%, transparent)",
            }}
          >
            <Stack spacing={0.75} alignItems="center">
              <Typography variant="caption" color="text.secondary">
                Scalar value
              </Typography>
              <Typography sx={{ fontSize: 44, fontWeight: 800, lineHeight: 1, fontFamily: "var(--mono)" }}>
                {scalarValue !== null ? String(scalarValue) : "-"}
              </Typography>
              {meta?.units && typeof meta.units.value === "string" ? (
                <Typography variant="caption" color="text.secondary">
                  {meta.units.value}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        </Stack>
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
              control={<Checkbox size="small" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} disabled={!selected || datasets.length === 0 || queryActive} />}
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
                  setColumns(Array.isArray(d?.columns) ? d.columns : []);
                  setData(d?.data ?? []);
                  setQueryActive(false);
                  setQuerySummary("");
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

      <Box sx={{ display: "grid", gridTemplateColumns: "256px 1fr", gap: 1.25, mt: 1.25 }}>
        <Box>
          <Box sx={{ ...sectionSx, mt: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
              Dataset
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
            {datasets.length === 0 && !loading ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.65, display: "block" }}>
                No datasets available yet.
              </Typography>
            ) : null}
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Advanced query
              </Typography>
              <Button size="small" variant="text" onClick={() => setQueryOpen((v) => !v)}>
                {queryOpen ? "Hide" : "Show"}
              </Button>
            </Stack>
            <Collapse in={queryOpen}>
              <TextField
                multiline
                minRows={6}
                maxRows={10}
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                fullWidth
                sx={{
                  mt: 0.75,
                  "& .MuiInputBase-root": {
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    alignItems: "flex-start",
                  },
                }}
              />
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!selected || loading || !queryText.trim()}
                  onClick={async () => {
                    if (!selected) return;
                    try {
                      setLoading(true);
                      setStreaming(false);
                      const resp = archiveMode && archiveId
                        ? await api.queryArchivedDataset(archiveId, selected, { query: queryText })
                        : await api.queryDataset(rid, selected, { query: queryText });
                      setColumns(Array.isArray(resp?.columns) ? resp.columns : []);
                      setData(Array.isArray(resp?.data) ? resp.data : []);
                      setQueryActive(true);
                      setQuerySummary(
                        resp?.query
                          ? `${resp.query.row_count} rows${resp.query.aggregated ? ", aggregated" : ""}${resp.query.grouped ? ", grouped" : ""}`
                          : "Query applied"
                      );
                    } catch (e: any) {
                      showToast("Query failed", e.message || String(e));
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Apply
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!queryActive || loading || !selected}
                  onClick={async () => {
                    if (!selected) return;
                    try {
                      setLoading(true);
                      const d: any = archiveMode && archiveId
                        ? await api.getArchivedDatasetData(archiveId, selected, { format: "json" })
                        : await api.getDatasetData(rid, selected, { format: "json" });
                      setColumns(Array.isArray(d?.columns) ? d.columns : []);
                      setData(d?.data ?? []);
                      setQueryActive(false);
                      setQuerySummary("");
                    } catch (e: any) {
                      showToast("Reset failed", e.message || String(e));
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Reset
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                `SELECT`, `WHERE`, `GROUP BY`, `AGG`, `ORDER BY`, `LIMIT`
              </Typography>
              {querySummary ? (
                <Typography variant="caption" sx={{ display: "block", mt: 0.4, color: "var(--accent-2)" }}>
                  {querySummary}
                </Typography>
              ) : null}
            </Collapse>
          </Box>

          {!schemaMode && (
            <>
              <Box sx={sectionSx}>
                <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                  Plot mode
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={plotMode}
                  onChange={(_, next) => next && setPlotMode(next)}
                  sx={{
                    "& .MuiToggleButton-root": { px: 1.2, py: 0.25, fontSize: 12, minHeight: 28 },
                  }}
                >
                  <ToggleButton value="1d">1D</ToggleButton>
                  <ToggleButton value="2d">2D</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <Box sx={sectionSx}>
                <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                  X axis
                </Typography>
                <Stack spacing={0.6}>
                  <Select size="small" value={xField} onChange={(e) => setXField(e.target.value)} fullWidth>
                    {fieldOptions.map((f) => (
                      <MenuItem key={f} value={f}>{f}</MenuItem>
                    ))}
                  </Select>
                  <Stack direction="row" spacing={0.6}>
                    <Select size="small" value={xAgg} onChange={(e) => setXAgg(e.target.value as AggMode)} sx={{ minWidth: 116 }}>
                      <MenuItem value="none">none</MenuItem>
                      <MenuItem value="sum">sum</MenuItem>
                      <MenuItem value="average">average</MenuItem>
                      <MenuItem value="threshold">threshold</MenuItem>
                    </Select>
                    <Select size="small" value={xAggField} onChange={(e) => setXAggField(e.target.value)} fullWidth>
                      {fieldOptions.map((f) => (
                        <MenuItem key={`xagg-${f}`} value={f}>{f}</MenuItem>
                      ))}
                    </Select>
                  </Stack>
                  {xAgg === "threshold" && (
                    <TextField size="small" value={xThreshold} onChange={(e) => setXThreshold(e.target.value)} placeholder="threshold" fullWidth />
                  )}
                </Stack>
              </Box>

              <Box sx={sectionSx}>
                <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                  Y axis
                </Typography>
                <Stack spacing={0.6}>
                  <Select size="small" value={yField} onChange={(e) => setYField(e.target.value)} fullWidth>
                    {fieldOptions.map((f) => (
                      <MenuItem key={f} value={f}>{f}</MenuItem>
                    ))}
                  </Select>
                  <Stack direction="row" spacing={0.6}>
                    <Select size="small" value={yAgg} onChange={(e) => setYAgg(e.target.value as AggMode)} sx={{ minWidth: 116 }}>
                      <MenuItem value="none">none</MenuItem>
                      <MenuItem value="sum">sum</MenuItem>
                      <MenuItem value="average">average</MenuItem>
                      <MenuItem value="threshold">threshold</MenuItem>
                    </Select>
                    <Select size="small" value={yAggField} onChange={(e) => setYAggField(e.target.value)} fullWidth>
                      {fieldOptions.map((f) => (
                        <MenuItem key={`yagg-${f}`} value={f}>{f}</MenuItem>
                      ))}
                    </Select>
                  </Stack>
                  {yAgg === "threshold" && (
                    <TextField size="small" value={yThreshold} onChange={(e) => setYThreshold(e.target.value)} placeholder="threshold" fullWidth />
                  )}
                </Stack>
              </Box>

              {plotMode === "2d" && (
                <Box sx={sectionSx}>
                  <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                    Z axis
                  </Typography>
                  <Stack spacing={0.6}>
                    <Select size="small" value={zField} onChange={(e) => setZField(e.target.value)} fullWidth>
                      {fieldOptions.map((f) => (
                        <MenuItem key={f} value={f}>{f}</MenuItem>
                      ))}
                    </Select>
                    <Stack direction="row" spacing={0.6}>
                      <Select size="small" value={zAgg} onChange={(e) => setZAgg(e.target.value as AggMode)} sx={{ minWidth: 116 }}>
                        <MenuItem value="none">none</MenuItem>
                        <MenuItem value="sum">sum</MenuItem>
                        <MenuItem value="average">average</MenuItem>
                        <MenuItem value="threshold">threshold</MenuItem>
                      </Select>
                      <Select size="small" value={zAggField} onChange={(e) => setZAggField(e.target.value)} fullWidth>
                        {fieldOptions.map((f) => (
                          <MenuItem key={`zagg-${f}`} value={f}>{f}</MenuItem>
                        ))}
                      </Select>
                    </Stack>
                    {zAgg === "threshold" && (
                      <TextField size="small" value={zThreshold} onChange={(e) => setZThreshold(e.target.value)} placeholder="threshold" fullWidth />
                    )}
                  </Stack>
                </Box>
              )}
            </>
          )}

          {schemaMode && (
            <>
              <Box sx={sectionSx}>
                <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                  Variables
                </Typography>
                <Select size="small" value={selectedVariable} onChange={(e) => setSelectedVariable(e.target.value)} fullWidth>
                  {(schemaParamAxes.length > 0 ? schemaParamAxes : ["index"]).map((name) => (
                    <MenuItem key={name} value={name}>{name}</MenuItem>
                  ))}
                </Select>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Data column (single-select)
                </Typography>
                <Select
                  size="small"
                  value={selectedDataColumn}
                  onChange={(e) => setSelectedDataColumn(e.target.value)}
                  fullWidth
                >
                  {schemaDataAxesEffective.map((name) => (
                    <MenuItem key={name} value={name}>{name}</MenuItem>
                  ))}
                </Select>
              </Box>
            </>
          )}

          <Box sx={{ mt: 1.25 }}>
            <Typography variant="caption" color="text.secondary">
              {queryActive ? "Showing transformed query results." : "Select axes to explore the dataset."}
            </Typography>
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            Live plot
          </Typography>
          <Typography variant="caption" color="text.secondary">
            rows: {Array.isArray(data) ? data.length : 0}
            {schemaMode
              ? ` · variable: ${selectedVariable || "?"} · column: ${selectedDataColumn || "?"}`
              : ` · x: ${xField || "?"} · y: ${yField || "?"}${plotMode === "2d" ? ` · z: ${zField || "?"}` : ""}`}
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
                yaxis: { title: schemaMode ? (selectedDataColumn || "data") : (yField || "y") },
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

      <Dialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        maxWidth="xs"
        fullWidth={false}
        PaperProps={{ sx: { width: "min(460px, calc(100% - 24px))", m: 1.5 } }}
      >
        <DialogTitle sx={{ overflowWrap: "anywhere", pb: 1, borderBottom: "1px solid var(--border)" }}>
          Create archive
        </DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.25, pt: 1.5, overflowX: "hidden" }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Archive title
            </Typography>
            <TextField
              size="small"
              value={archiveTitle}
              onChange={(e) => setArchiveTitle(e.target.value)}
              placeholder={`Run ${rid} Archive`}
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Tags (CSV)
            </Typography>
            <TextField
              size="small"
              value={archiveTags}
              onChange={(e) => setArchiveTags(e.target.value)}
              placeholder="analysis, calibration"
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Note
            </Typography>
            <TextField
              size="small"
              value={archiveNote}
              onChange={(e) => setArchiveNote(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Datasets</Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5, maxHeight: 180, overflowY: "auto", pr: 0.5 }}>
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
                    label={<Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>{d.name}</Typography>}
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
            sx={{ textTransform: "none" }}
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
