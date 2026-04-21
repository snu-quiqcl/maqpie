import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
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

// Dataset patches arrive as either full snapshots or incremental row appends.
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
type DimensionMode = "fixed" | "aggregate" | "raw";
type DimensionConfig = {
  mode: DimensionMode;
  value: string;
  agg: Exclude<AggMode, "none">;
  threshold: string;
};
type DataViewerPersistedState = {
  selected?: string;
  plotMode?: "1d" | "2d";
  xField?: string;
  yField?: string;
  zField?: string;
  dimensionConfigs?: Record<string, DimensionConfig>;
  dimensionsOpen?: boolean;
  selectedVariable?: string;
  selectedDataColumn?: string;
  queryText?: string;
  queryOpen?: boolean;
};
type DataViewerViewProps = {
  rid: number;
  datasetName?: string;
  archiveId?: number;
  tabId?: string;
  viewerState?: Record<string, unknown>;
};

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
  // Data can arrive as arrays, objects, or scalars depending on backend/query mode.
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

function getFieldRaw(row: DataRow, field: string, index: number, arrayColumns?: string[]): unknown {
  if (field === "index") return index;
  if (Array.isArray(row)) {
    let idx = -1;
    if (arrayColumns && arrayColumns.length > 0) idx = arrayColumns.indexOf(field);
    if (idx < 0) {
      const match = field.match(/^col(\d+)$/);
      if (!match) return null;
      idx = Number(match[1]);
    }
    return row[idx];
  }
  if (row && typeof row === "object") {
    return (row as Record<string, unknown>)[field];
  }
  if (field === "value") return row;
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

function valueKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

// The Data Viewer handles live runs and archived datasets through the same plotting/query surface.
export default function DataViewerView({ rid, datasetName, archiveId, tabId = "", viewerState }: DataViewerViewProps) {
  const showToast = useAppStore((s) => s.showToast);
  const updateTabProps = useAppStore((s) => s.updateTabProps);
  const persisted = viewerState as DataViewerPersistedState | undefined;

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selected, setSelected] = useState<string>(persisted?.selected ?? datasetName ?? "");
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [baseMeta, setBaseMeta] = useState<DatasetMeta | null>(null);
  const [baseData, setBaseData] = useState<any[]>([]);
  const [baseColumns, setBaseColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [plotMode, setPlotMode] = useState<"1d" | "2d">(persisted?.plotMode === "2d" ? "2d" : "1d");
  const [xField, setXField] = useState(typeof persisted?.xField === "string" ? persisted.xField : "");
  const [yField, setYField] = useState(typeof persisted?.yField === "string" ? persisted.yField : "");
  const [zField, setZField] = useState(typeof persisted?.zField === "string" ? persisted.zField : "");
  const [dimensionConfigs, setDimensionConfigs] = useState<Record<string, DimensionConfig>>(
    persisted?.dimensionConfigs && typeof persisted.dimensionConfigs === "object" ? persisted.dimensionConfigs : {}
  );
  const [dimensionsOpen, setDimensionsOpen] = useState(Boolean(persisted?.dimensionsOpen));
  const [selectedVariable, setSelectedVariable] = useState(typeof persisted?.selectedVariable === "string" ? persisted.selectedVariable : "");
  const [selectedDataColumn, setSelectedDataColumn] = useState(typeof persisted?.selectedDataColumn === "string" ? persisted.selectedDataColumn : "");
  const [queryText, setQueryText] = useState(typeof persisted?.queryText === "string" ? persisted.queryText : "");
  const [queryActive, setQueryActive] = useState(false);
  const [querySummary, setQuerySummary] = useState<string>("");
  const [queryOpen, setQueryOpen] = useState(Boolean(persisted?.queryOpen));

  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTitle, setArchiveTitle] = useState("");
  const [archiveTags, setArchiveTags] = useState("");
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveDatasets, setArchiveDatasets] = useState<string[]>([]);

  // Some tabs are opened before a concrete run is selected.
  const ridValid = rid && rid > 0;
  const archiveMode = Boolean(archiveId);
  const persistedSnapshot = useMemo<DataViewerPersistedState>(() => ({
    selected,
    plotMode,
    xField,
    yField,
    zField,
    dimensionConfigs,
    dimensionsOpen,
    selectedVariable,
    selectedDataColumn,
    queryText,
    queryOpen,
  }), [
    selected,
    plotMode,
    xField,
    yField,
    zField,
    dimensionConfigs,
    dimensionsOpen,
    selectedVariable,
    selectedDataColumn,
    queryText,
    queryOpen,
  ]);

  useEffect(() => {
    setSelected(persisted?.selected ?? datasetName ?? "");
    setPlotMode(persisted?.plotMode === "2d" ? "2d" : "1d");
    setXField(typeof persisted?.xField === "string" ? persisted.xField : "");
    setYField(typeof persisted?.yField === "string" ? persisted.yField : "");
    setZField(typeof persisted?.zField === "string" ? persisted.zField : "");
    setDimensionConfigs(
      persisted?.dimensionConfigs && typeof persisted.dimensionConfigs === "object" ? persisted.dimensionConfigs : {}
    );
    setDimensionsOpen(Boolean(persisted?.dimensionsOpen));
    setSelectedVariable(typeof persisted?.selectedVariable === "string" ? persisted.selectedVariable : "");
    setSelectedDataColumn(typeof persisted?.selectedDataColumn === "string" ? persisted.selectedDataColumn : "");
    setQueryText(typeof persisted?.queryText === "string" ? persisted.queryText : "");
    setQueryOpen(Boolean(persisted?.queryOpen));
  }, [datasetName, persisted, tabId]);

  useEffect(() => {
    if (!tabId) return;
    const timer = window.setTimeout(() => {
      updateTabProps(tabId, {
        datasetName: selected,
        viewerState: persistedSnapshot,
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [persistedSnapshot, selected, tabId, updateTabProps]);

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
          const nextMeta = {
            rid: a.rid,
            name: selected,
            dtype: "unknown",
            shape: [],
          };
          const nextColumns = Array.isArray(d?.columns) ? d.columns : [];
          const nextData = d?.data ?? [];
          setMeta(nextMeta);
          setBaseMeta(nextMeta);
          setColumns(nextColumns);
          setBaseColumns(nextColumns);
          setData(nextData);
          setBaseData(nextData);
          setQueryActive(false);
          setQuerySummary("");
        } else {
          const m: DatasetMeta = await api.getDatasetMeta(rid, selected);
          const d: any = await api.getDatasetData(rid, selected, { format: "json" });
          if (!mounted) return;
          const nextColumns = Array.isArray(d?.columns) ? d.columns : [];
          const nextData = d?.data ?? [];
          setMeta(m);
          setBaseMeta(m);
          setColumns(nextColumns);
          setBaseColumns(nextColumns);
          setData(nextData);
          setBaseData(nextData);
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
    mt: 0.65,
    p: 0.65,
    border: "1px solid color-mix(in srgb, var(--accent) 18%, var(--border))",
    borderRadius: 1,
    background: "color-mix(in srgb, var(--accent) 9%, var(--panel2))",
    boxShadow: "inset 0 1px 0 color-mix(in srgb, white 6%, transparent)",
  } as const;
  const sectionTitleSx = { display: "block", mb: 0.4, letterSpacing: "0.02em" } as const;
  const clampSelectSx = {
    minWidth: 0,
    "& .MuiSelect-select": {
      minWidth: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
  } as const;

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
      if (queryActive && queryText.trim()) {
        ws.send(JSON.stringify({ query: queryText.trim() }));
      }
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
        setBaseData([]);
        return;
      }

      if (msg.type === "snapshot") {
        const nextColumns = Array.isArray(msg.columns) ? msg.columns : [];
        const nextData = Array.isArray(msg.data) ? msg.data : [];
        setColumns(nextColumns);
        setData(nextData);
        if (!queryActive) {
          setBaseColumns(nextColumns);
          setBaseData(nextData);
        }
        return;
      }

      if (msg.type === "append") {
        if (Array.isArray(msg.columns) && msg.columns.length > 0) {
          setColumns(msg.columns);
          if (!queryActive) {
            setBaseColumns(msg.columns);
          }
        }
        const nextRows = Array.isArray(msg.rows) ? msg.rows : [];
        setData((prev) => {
          return prev.concat(nextRows);
        });
        if (!queryActive) {
          setBaseData((prev) => prev.concat(nextRows));
        }
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
  }, [rid, ridValid, selected, streaming, showToast, archiveMode, queryActive, queryText]);

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
  }, [fieldOptions, xField, yField, zField]);

  const hiddenFields = useMemo(() => {
    const visible = new Set<string>([xField, yField]);
    if (plotMode === "2d" && zField) visible.add(zField);
    return fieldOptions.filter((field) => field !== "index" && !visible.has(field));
  }, [fieldOptions, plotMode, xField, yField, zField]);

  const valueOptionsByField = useMemo(() => {
    const rows = Array.isArray(data) ? data : [];
    const out: Record<string, Array<{ key: string; label: string }>> = {};
    for (const field of hiddenFields) {
      const seen = new Set<string>();
      const options: Array<{ key: string; label: string }> = [];
      rows.forEach((row, idx) => {
        const raw = getFieldRaw(row as DataRow, field, idx, columns);
        const key = valueKey(raw);
        if (seen.has(key)) return;
        seen.add(key);
        options.push({ key, label: valueLabel(raw) });
      });
      out[field] = options;
    }
    return out;
  }, [columns, data, hiddenFields]);

  useEffect(() => {
    setDimensionConfigs((prev) => {
      const next: Record<string, DimensionConfig> = {};
      let aggregateAssigned = false;
      for (const field of hiddenFields) {
        const options = valueOptionsByField[field] ?? [];
        const prevConfig = prev[field];
        const nextValue =
          prevConfig?.value && options.some((opt) => opt.key === prevConfig.value)
            ? prevConfig.value
            : (options[0]?.key ?? "");
        const wantsAggregate = prevConfig?.mode === "aggregate" && !aggregateAssigned;
        next[field] = {
          mode: wantsAggregate ? "aggregate" : (prevConfig?.mode === "raw" ? "raw" : "fixed"),
          value: nextValue,
          agg: prevConfig?.agg ?? "average",
          threshold: prevConfig?.threshold ?? "0",
        };
        if (wantsAggregate) aggregateAssigned = true;
      }
      return next;
    });
  }, [hiddenFields, valueOptionsByField]);

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

    const aggregateField = hiddenFields.find((field) => dimensionConfigs[field]?.mode === "aggregate") ?? null;
    const aggregateConfig = aggregateField ? dimensionConfigs[aggregateField] : null;
    const rows = (Array.isArray(data) ? data : []).filter((row, idx) =>
      hiddenFields.every((field) => {
        if (field === aggregateField) return true;
        if (dimensionConfigs[field]?.mode === "raw") return true;
        const selectedValue = dimensionConfigs[field]?.value ?? "";
        if (!selectedValue) return true;
        return valueKey(getFieldRaw(row as DataRow, field, idx, columns)) === selectedValue;
      })
    );
    const points = rows.map((row, idx) => {
      const xVal = getFieldValue(row as DataRow, xField, idx, columns);
      const yVal = getFieldValue(row as DataRow, yField, idx, columns);
      const zVal = getFieldValue(row as DataRow, zField, idx, columns);
      return { row, idx, x: xVal, y: yVal, z: zVal };
    });

    let xyPoints = points.filter((p) => p.x !== null && p.y !== null) as Array<{ row: any; idx: number; x: number; y: number; z: number | null }>;
    let xyzPoints = points.filter((p) => p.x !== null && p.y !== null && p.z !== null) as Array<{ row: any; idx: number; x: number; y: number; z: number }>;
    if (aggregateField && aggregateConfig) {
      const thresholdValue = Number(aggregateConfig.threshold);
      const threshold = Number.isFinite(thresholdValue) ? thresholdValue : 0;

      if (plotMode === "1d") {
        const grouped = new Map<number, number[]>();
        for (const point of xyPoints) {
          const values = grouped.get(point.x) ?? [];
          values.push(point.y);
          grouped.set(point.x, values);
        }
        xyPoints = Array.from(grouped.entries())
          .sort((a, b) => a[0] - b[0])
          .flatMap(([x, values]) => {
            const y = aggregate(values, aggregateConfig.agg, threshold);
            return y === null ? [] : [{ row: null, idx: 0, x, y, z: null }];
          });
      } else {
        const grouped = new Map<string, { x: number; y: number; values: number[] }>();
        for (const point of xyzPoints) {
          const key = `${point.x}\u0000${point.y}`;
          const entry = grouped.get(key) ?? { x: point.x, y: point.y, values: [] };
          entry.values.push(point.z);
          grouped.set(key, entry);
        }
        xyzPoints = Array.from(grouped.values())
          .sort((a, b) => (a.x - b.x) || (a.y - b.y))
          .flatMap((entry) => {
            const z = aggregate(entry.values, aggregateConfig.agg, threshold);
            return z === null ? [] : [{ row: null, idx: 0, x: entry.x, y: entry.y, z }];
          });
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
    hiddenFields, dimensionConfigs
  ]);

  if (!ridValid) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Data Viewer</Typography>
      </Paper>
    );
  }

  if (scalarMode) {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Stack spacing={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {archiveMode ? `Archive ${archiveId}` : `Run ${rid}`}
          </Typography>
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
    <Paper
      variant="outlined"
      sx={{
        p: 1.05,
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.75} sx={{ flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {archiveMode ? `Archive ${archiveId}` : `Run ${rid}`}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {!archiveMode && streaming && queryActive && (
            <Chip
              size="small"
              label="Live query"
              color="secondary"
              variant="outlined"
              sx={{
                height: 22,
                fontSize: 11,
                "& .MuiChip-label": {
                  px: 0.8,
                  fontFamily: "var(--mono)",
                },
              }}
            />
          )}
          {!archiveMode && (
            <FormControlLabel
              control={<Checkbox size="small" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} disabled={!selected || datasets.length === 0} />}
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
                  const nextColumns = Array.isArray(d?.columns) ? d.columns : [];
                  const nextData = d?.data ?? [];
                  setColumns(nextColumns);
                  setBaseColumns(nextColumns);
                  setData(nextData);
                  setBaseData(nextData);
                  setBaseMeta(meta);
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
          <Button
            size="small"
            variant="outlined"
            disabled={!selected || loading}
            onClick={async () => {
              if (!selected) return;
              try {
                if (archiveMode && archiveId) {
                  await api.downloadArchivedDatasetRaw(archiveId, selected);
                } else {
                  await api.downloadDatasetRaw(rid, selected);
                }
                showToast("Download started", selected);
              } catch (e: any) {
                showToast("Download failed", e.message || String(e));
              }
            }}
          >
            Download CSV
          </Button>
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

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "224px 1fr",
          gap: 0.85,
          mt: 0.85,
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
          alignItems: "stretch",
        }}
      >
        {/* Keep controls independently scrollable so dense datasets do not push the plot off-screen. */}
        <Box
          sx={{
            minHeight: 0,
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            pr: 0.35,
            pl: 0.2,
            py: 0.2,
            borderRadius: 1.2,
            border: "1px solid color-mix(in srgb, var(--accent) 16%, var(--border))",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--panel2)) 0%, color-mix(in srgb, var(--accent) 4%, var(--panel2)) 100%)",
          }}
        >
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
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.6 }}>
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
                  mt: 0.6,
                  "& .MuiInputBase-root": {
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    alignItems: "flex-start",
                  },
                }}
              />
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.55 }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!selected || loading || !queryText.trim()}
                  onClick={async () => {
                    if (!selected) return;
                    try {
                      setLoading(true);
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
                      if (!archiveMode && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ query: queryText.trim() }));
                      }
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
                  onClick={() => {
                    setMeta(baseMeta);
                    setColumns(baseColumns);
                    setData(baseData);
                    setQueryActive(false);
                    setQuerySummary("");
                    if (!archiveMode && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                      wsRef.current.send(JSON.stringify({ op: "reset_query" }));
                    }
                  }}
                >
                  Reset
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.6 }}>
                `SELECT`, `WHERE`, `GROUP BY`, `AGG`, `ORDER BY`, `LIMIT`
              </Typography>
              {querySummary ? (
                <Typography variant="caption" sx={{ display: "block", mt: 0.3, color: "var(--accent-2)" }}>
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
                    "& .MuiToggleButton-root": { px: 0.9, py: 0.15, fontSize: 11.5, minHeight: 24 },
                  }}
                >
                  <ToggleButton value="1d">2D</ToggleButton>
                  <ToggleButton value="2d">3D</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {hiddenFields.length > 0 && (
                <Box sx={sectionSx}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                      Dimensions
                    </Typography>
                    <Button size="small" variant="text" onClick={() => setDimensionsOpen((v) => !v)}>
                      {dimensionsOpen ? "Hide" : "Show"}
                    </Button>
                  </Stack>
                  <Collapse in={dimensionsOpen}>
                    <Stack spacing={0.6}>
                      {hiddenFields.map((field) => (
                        <Box
                          key={field}
                          sx={{
                            border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
                            borderRadius: 1,
                            px: 0.65,
                            py: 0.55,
                          }}
                        >
                          <Stack direction="row" spacing={0.55} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ width: 56, flexShrink: 0, textTransform: "none" }}
                            >
                              {field}
                            </Typography>
                            <Select
                              size="small"
                              value={dimensionConfigs[field]?.mode ?? "fixed"}
                              onChange={(e) => {
                                const nextMode = e.target.value as DimensionMode;
                                setDimensionConfigs((prev) => {
                                  const next: Record<string, DimensionConfig> = {};
                                  for (const hiddenField of hiddenFields) {
                                    const current = prev[hiddenField];
                                    const options = valueOptionsByField[hiddenField] ?? [];
                                    const preservedMode =
                                      nextMode === "aggregate" && current?.mode === "aggregate"
                                        ? "fixed"
                                        : (current?.mode ?? "fixed");
                                    next[hiddenField] = {
                                      mode: hiddenField === field ? nextMode : preservedMode,
                                      value:
                                        current?.value && options.some((opt) => opt.key === current.value)
                                          ? current.value
                                          : (options[0]?.key ?? ""),
                                      agg: current?.agg ?? "average",
                                      threshold: current?.threshold ?? "0",
                                    };
                                  }
                                  return next;
                                });
                              }}
                              sx={{ ...clampSelectSx, minWidth: 74, flexShrink: 0 }}
                            >
                              <MenuItem value="fixed">Fix</MenuItem>
                              <MenuItem value="raw">Raw</MenuItem>
                              <MenuItem value="aggregate">Agg</MenuItem>
                            </Select>
                            {dimensionConfigs[field]?.mode === "aggregate" ? (
                              <>
                                <Select
                                  size="small"
                                  value={dimensionConfigs[field]?.agg ?? "average"}
                                  onChange={(e) =>
                                    setDimensionConfigs((prev) => ({
                                      ...prev,
                                      [field]: {
                                        ...(prev[field] ?? {
                                          mode: "aggregate",
                                          value: "",
                                          agg: "average",
                                          threshold: "0",
                                        }),
                                        agg: e.target.value as Exclude<AggMode, "none">,
                                      },
                                    }))
                                  }
                                  sx={{ ...clampSelectSx, minWidth: 104, flex: 1 }}
                                >
                                  <MenuItem value="average">Average</MenuItem>
                                  <MenuItem value="sum">Sum</MenuItem>
                                  <MenuItem value="threshold">Threshold</MenuItem>
                                </Select>
                                {dimensionConfigs[field]?.agg === "threshold" && (
                                  <TextField
                                    size="small"
                                    value={dimensionConfigs[field]?.threshold ?? "0"}
                                    onChange={(e) =>
                                      setDimensionConfigs((prev) => ({
                                        ...prev,
                                        [field]: {
                                          ...(prev[field] ?? {
                                            mode: "aggregate",
                                            value: "",
                                            agg: "threshold",
                                            threshold: "0",
                                          }),
                                          threshold: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Threshold"
                                    sx={{ width: 104, flexShrink: 0 }}
                                  />
                                )}
                              </>
                            ) : dimensionConfigs[field]?.mode === "raw" ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ flex: 1, minWidth: 0, textAlign: "center" }}
                              >
                                All values
                              </Typography>
                            ) : (
                              <Select
                                size="small"
                                value={dimensionConfigs[field]?.value ?? ""}
                                onChange={(e) =>
                                  setDimensionConfigs((prev) => ({
                                    ...prev,
                                    [field]: {
                                      ...(prev[field] ?? {
                                        mode: "fixed",
                                        value: "",
                                        agg: "average",
                                        threshold: "0",
                                      }),
                                      value: e.target.value,
                                    },
                                  }))
                                }
                                sx={{ ...clampSelectSx, minWidth: 0, flex: 1 }}
                              >
                                {(valueOptionsByField[field] ?? []).map((option) => (
                                  <MenuItem
                                    key={`${field}-${option.key}`}
                                    value={option.key}
                                    sx={{ maxWidth: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                  >
                                    {option.label}
                                  </MenuItem>
                                ))}
                              </Select>
                            )}
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              )}

              <Box sx={sectionSx}>
                <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                  X axis
                </Typography>
                <Select size="small" value={xField} onChange={(e) => setXField(e.target.value)} fullWidth sx={clampSelectSx}>
                  {fieldOptions.map((f) => (
                    <MenuItem key={f} value={f} sx={{ maxWidth: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f}</MenuItem>
                  ))}
                </Select>
              </Box>

              <Box sx={sectionSx}>
                <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                  Y axis
                </Typography>
                <Select size="small" value={yField} onChange={(e) => setYField(e.target.value)} fullWidth sx={clampSelectSx}>
                  {fieldOptions.map((f) => (
                    <MenuItem key={f} value={f} sx={{ maxWidth: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f}</MenuItem>
                  ))}
                </Select>
              </Box>

              {plotMode === "2d" && (
                <Box sx={sectionSx}>
                  <Typography variant="caption" color="text.secondary" sx={sectionTitleSx}>
                    Z axis
                  </Typography>
                  <Select size="small" value={zField} onChange={(e) => setZField(e.target.value)} fullWidth sx={clampSelectSx}>
                    {fieldOptions.map((f) => (
                      <MenuItem key={f} value={f} sx={{ maxWidth: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f}</MenuItem>
                    ))}
                  </Select>
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
                <Select size="small" value={selectedVariable} onChange={(e) => setSelectedVariable(e.target.value)} fullWidth sx={clampSelectSx}>
                  {(schemaParamAxes.length > 0 ? schemaParamAxes : ["index"]).map((name) => (
                    <MenuItem key={name} value={name} sx={{ maxWidth: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</MenuItem>
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
                  sx={clampSelectSx}
                >
                  {schemaDataAxesEffective.map((name) => (
                    <MenuItem key={name} value={name} sx={{ maxWidth: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</MenuItem>
                  ))}
                </Select>
              </Box>
            </>
          )}

        </Box>

        <Box sx={{ minHeight: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Typography variant="caption" color="text.secondary">
            rows: {Array.isArray(data) ? data.length : 0}
            {schemaMode
              ? ` · variable: ${selectedVariable || "?"} · column: ${selectedDataColumn || "?"}`
              : ` · x: ${xField || "?"} · y: ${yField || "?"}${plotMode === "2d" ? ` · z: ${zField || "?"}` : ""}`}
          </Typography>
          <Box sx={{ mt: 0.6, minHeight: 0, flex: 1 }}>
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
