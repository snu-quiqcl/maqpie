import { useEffect, useMemo, useState } from "react";
import { createWindowFrame } from "../lib/windowFrame";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material";
import MinimizeIcon from "@mui/icons-material/Minimize";
import { api } from "../lib/api";
import { useAppStore } from "../state/store";

type ParamSchemaField = {
  type?: string;
  default?: unknown;
  choices?: string[];
  min?: number;
  max?: number;
  global_min?: number;
  global_max?: number;
  global_step?: number;
  step?: number;
  unit?: string;
  scale?: number;
  ndecimals?: number;
};

type ParamKind = "bool" | "enum" | "number" | "string" | "scannable" | "iterable";
type NumericMode = "int" | "float";
type ScanType = "NoScan" | "RangeScan" | "CenterScan" | "ExplicitScan";
type ScanObject = {
  ty: ScanType;
  value?: number;
  repetitions?: number;
  start?: number;
  stop?: number;
  npoints?: number;
  center?: number;
  span?: number;
  step?: number;
  randomize?: boolean;
  seed?: number | null;
  sequence?: number[];
};

type PanelDTO = {
  panel_id: string;
  config_id?: string | null;
  config_meta?: { title: string; updated_at: string };
  name: string;
  class_name?: string;
  script_path: string;
  tags: string[];
  description?: string;
  param_schema: Record<string, ParamSchemaField>;
  param_values: Record<string, any>;
  panel?: {
    schedule_defaults?: {
      priority?: number;
      schedule_type?: "NOW" | "TIMED" | "RECURRING";
      scheduled_at?: string | null;
      interval_min?: number | null;
      timezone?: string | null;
      recurrence?: {
        kind?: "interval" | "daily" | "weekly";
        interval_min?: number | null;
        start_immediately?: boolean;
        start_at?: string | null;
        time?: string | null;
        every_n_days?: number | null;
        weekdays?: number[];
        every_n_weeks?: number | null;
        start_date?: string | null;
      } | null;
    };
  };
};

type Priority = number;
type ScheduleType = "NOW" | "TIMED" | "RECURRING";
type RecurrenceKind = "interval" | "daily" | "weekly";
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function normalizePanelTimezone(tz?: string | null) {
  const browserTz = detectBrowserTimezone();
  const raw = String(tz ?? "").trim();
  if (!raw) return browserTz;
  // Treat legacy UTC defaults as "no user-specific timezone chosen" so timed
  // scheduling follows the user's local browser timezone by default.
  if (raw === "UTC") return browserTz;
  return raw;
}

function toLocalDateTimeInput(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function paramKind(field: ParamSchemaField): ParamKind {
  const rawType = String(field.type ?? "").toLowerCase();
  const defaultValue = field.default;
  if (rawType === "bool" || rawType === "boolean" || rawType === "booleanvalue") return "bool";
  if (rawType === "enum" || rawType === "enumeration" || rawType === "enumerationvalue" || Array.isArray(field.choices)) return "enum";
  if (
    rawType === "scannable" ||
    rawType === "scan" ||
    scanTypeOf(defaultValue) ||
    (Array.isArray(defaultValue) && defaultValue.some((item) => scanTypeOf(item)))
  ) return "scannable";
  if (rawType === "int" || rawType === "float" || rawType === "number" || rawType === "auto" || rawType === "numbervalue") return "number";
  if (rawType === "iterable") return "iterable";
  return "string";
}

function numericMode(field: ParamSchemaField): NumericMode {
  const rawType = String(field.type ?? "").toLowerCase();
  if (rawType === "int") return "int";
  if (rawType === "float") return "float";
  if (field.ndecimals != null && field.ndecimals <= 0) return "int";
  if (field.step != null && Number.isInteger(field.step) && field.scale == null) return "int";
  return "float";
}

function scaleFor(field: ParamSchemaField) {
  const scale = Number(field.scale ?? 1);
  return Number.isFinite(scale) && scale !== 0 ? scale : 1;
}

function unitInputProps(field: ParamSchemaField) {
  const unit = String(field.unit ?? "").trim();
  return unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : undefined;
}

function displayNumber(value: unknown, field: ParamSchemaField): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const scaled = n / scaleFor(field);
  if (field.ndecimals != null && Number.isFinite(field.ndecimals)) {
    return scaled.toFixed(Math.max(0, Math.trunc(field.ndecimals)));
  }
  return String(scaled);
}

function parseDisplayNumber(raw: string, field: ParamSchemaField): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = numericMode(field) === "int" ? Number.parseInt(value, 10) : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const backendValue = n * scaleFor(field);
  return numericMode(field) === "int" ? Math.trunc(backendValue) : backendValue;
}

function scanTypeOf(value: unknown): ScanType | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ty = String((value as Record<string, unknown>).ty ?? "");
  return ty === "NoScan" || ty === "RangeScan" || ty === "CenterScan" || ty === "ExplicitScan" ? ty : null;
}

function defaultScanObject(field: ParamSchemaField): ScanObject {
  const rawDefault = field.default;
  const candidate = Array.isArray(rawDefault) ? rawDefault.find((item) => scanTypeOf(item)) : rawDefault;
  if (scanTypeOf(candidate)) return candidate as ScanObject;
  const value = Number(rawDefault);
  return {
    ty: "NoScan",
    value: Number.isFinite(value) ? value : 0,
    repetitions: 1,
  };
}

function sanitizeScanObject(scan: ScanObject): ScanObject {
  if (scan.ty === "NoScan") {
    return {
      ty: "NoScan",
      value: Number(scan.value ?? 0),
      ...(scan.repetitions != null ? { repetitions: Math.max(1, Math.trunc(Number(scan.repetitions))) } : {}),
    };
  }
  if (scan.ty === "RangeScan") {
    return {
      ty: "RangeScan",
      start: Number(scan.start ?? 0),
      stop: Number(scan.stop ?? 0),
      npoints: Math.max(1, Math.trunc(Number(scan.npoints ?? 1))),
      ...(scan.randomize != null ? { randomize: Boolean(scan.randomize) } : {}),
      ...(scan.seed != null ? { seed: Math.trunc(Number(scan.seed)) } : {}),
    };
  }
  if (scan.ty === "CenterScan") {
    return {
      ty: "CenterScan",
      center: Number(scan.center ?? 0),
      span: Number(scan.span ?? 0),
      step: Number(scan.step ?? 0),
      ...(scan.randomize != null ? { randomize: Boolean(scan.randomize) } : {}),
      ...(scan.seed != null ? { seed: Math.trunc(Number(scan.seed)) } : {}),
    };
  }
  return {
    ty: "ExplicitScan",
    sequence: Array.isArray(scan.sequence) ? scan.sequence.map(Number).filter((n) => Number.isFinite(n)) : [],
  };
}

function scanToInputValue(value: unknown, field: ParamSchemaField): string {
  const candidate = scanTypeOf(value) ? value : defaultScanObject(field);
  return JSON.stringify(sanitizeScanObject(candidate as ScanObject));
}

function parseScanInput(raw: string, field: ParamSchemaField): ScanObject {
  const parsed = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  const declared = defaultScanObject(field);
  if (!scanTypeOf(parsed)) return declared;
  const scan = parsed as ScanObject;
  return scan.ty === declared.ty ? scan : declared;
}

function scaledScanNumber(value: unknown, field: ParamSchemaField): string {
  return displayNumber(value, field);
}

function unscaleScanNumber(raw: string, field: ParamSchemaField): number | null {
  return parseDisplayNumber(raw, field);
}

function parseInteger(raw: string): number | null {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInteger(raw: string): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return parseInteger(value);
}

function parseDisplayNumberList(raw: string, field: ParamSchemaField): number[] {
  return String(raw ?? "")
    .split(",")
    .map((part) => unscaleScanNumber(part.trim(), field))
    .filter((value): value is number => value !== null);
}

function formatDisplayNumberList(values: unknown, field: ParamSchemaField): string {
  if (!Array.isArray(values)) return "";
  return values.map((value) => displayNumber(value, field)).filter(Boolean).join(", ");
}

function paramInputValue(value: unknown, field: ParamSchemaField): string {
  const kind = paramKind(field);
  if (kind === "scannable") return scanToInputValue(value ?? field.default, field);
  if (kind === "number") return displayNumber(value ?? field.default, field);
  if (kind === "bool") return String(Boolean(value ?? field.default ?? false));
  if (value === undefined || value === null) {
    if (field.default === undefined || field.default === null) return "";
    return String(field.default);
  }
  return String(value);
}

function coerceValue(raw: string, field: ParamSchemaField) {
  const value = String(raw ?? "").trim();
  const kind = paramKind(field);
  if (kind === "bool") return value === "true" || value === "1";
  if (kind === "scannable") return sanitizeScanObject(parseScanInput(raw, field));
  if (value.length === 0) return null;
  if (kind === "number") {
    return parseDisplayNumber(value, field);
  }
  if (kind === "iterable") {
    const items = value.split(",").map((part) => part.trim()).filter(Boolean);
    return items.length ? items : null;
  }
  return value;
}

function validateParamInput(name: string, raw: string, field: ParamSchemaField): string | null {
  const value = String(raw ?? "").trim();
  const kind = paramKind(field);
  if (kind === "bool") return null;
  if (kind === "scannable") {
    const scan = parseScanInput(raw, field);
    if (scan.ty === "NoScan" && scan.value == null) return `${name}: NoScan requires a value`;
    if (scan.ty === "RangeScan" && (scan.start == null || scan.stop == null || scan.npoints == null)) return `${name}: RangeScan requires start, stop, and npoints`;
    if (scan.ty === "CenterScan" && (scan.center == null || scan.span == null || scan.step == null)) return `${name}: CenterScan requires center, span, and step`;
    if (scan.ty === "ExplicitScan" && (!Array.isArray(scan.sequence) || scan.sequence.length === 0)) return `${name}: ExplicitScan requires one or more values`;
    return null;
  }
  if (value.length === 0) return null;

  if (kind === "number" && numericMode(field) === "int") {
    if (!/^-?\d+$/.test(value)) return `${name}: expected an integer`;
    const n = parseDisplayNumber(value, field);
    if (n == null) return `${name}: expected an integer`;
    if (field.min != null && n < field.min) return `${name}: must be >= ${field.min}`;
    if (field.max != null && n > field.max) return `${name}: must be <= ${field.max}`;
    return null;
  }

  if (kind === "number") {
    const n = parseDisplayNumber(value, field);
    if (n == null || !Number.isFinite(n)) return `${name}: expected a number`;
    if (field.min != null && n < field.min) return `${name}: must be >= ${field.min}`;
    if (field.max != null && n > field.max) return `${name}: must be <= ${field.max}`;
    return null;
  }

  if (kind === "iterable") {
    const items = value.split(",").map((part) => part.trim()).filter(Boolean);
    if (!items.length) return `${name}: enter one or more comma-separated values`;
    return null;
  }

  return null;
}

// Experiment panels are the bridge between script-derived parameter schema and queueable run requests.
export default function ExperimentPanelView({
  panelId,
  compact,
  minimizedCard,
  onRestore,
  windowId,
  tabId,
}: {
  panelId: string;
  compact?: boolean;
  minimizedCard?: boolean;
  onRestore?: () => void;
  windowId?: string;
  tabId?: string;
}) {
  const showToast = useAppStore((s) => s.showToast);
  const addWindow = useAppStore((s) => s.addWindow);
  const minimizePanelTab = useAppStore((s) => s.minimizePanelTab);

  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PanelDTO | null>(null);

  // run config
  const [priority, setPriority] = useState<Priority>(3);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("NOW");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [intervalMin, setIntervalMin] = useState<string>("");
  const [scheduleTimezone, setScheduleTimezone] = useState<string>(detectBrowserTimezone());
  const [recurrenceKind, setRecurrenceKind] = useState<RecurrenceKind>("interval");
  const [recurrenceStartImmediately, setRecurrenceStartImmediately] = useState(true);
  const [recurrenceStartAt, setRecurrenceStartAt] = useState<string>("");
  const [dailyTime, setDailyTime] = useState<string>("09:00");
  const [dailyEvery, setDailyEvery] = useState<string>("1");
  const [weeklyTime, setWeeklyTime] = useState<string>("09:00");
  const [weeklyEvery, setWeeklyEvery] = useState<string>("1");
  const [weeklyDays, setWeeklyDays] = useState<number[]>([0]);

  // single-run parameter form
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});

  const [configTitle, setConfigTitle] = useState<string>("");
  const [configTags, setConfigTags] = useState<string>("");
  const [saveConfigOpen, setSaveConfigOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const p: PanelDTO = await api.getPanel(panelId);
        if (!mounted) return;

        setPanel(p);

        // Defaults
        const defaults = p.panel?.schedule_defaults;
        if (typeof defaults?.priority === "number") setPriority(defaults.priority as Priority);
        if (defaults?.schedule_type) setScheduleType(defaults.schedule_type);
        if (defaults?.scheduled_at) setScheduledAt(toLocalDateTimeInput(defaults.scheduled_at));
        if (defaults?.interval_min != null) setIntervalMin(String(defaults.interval_min));
        setScheduleTimezone(normalizePanelTimezone(defaults?.timezone));
        setAdvancedOpen(Boolean(
          (typeof defaults?.priority === "number" && defaults.priority !== 3) ||
          (defaults?.schedule_type && defaults.schedule_type !== "NOW") ||
          defaults?.recurrence
        ));
        if (defaults?.recurrence) {
          const recurrence = defaults.recurrence;
          if (recurrence.kind === "interval" || recurrence.kind === "daily" || recurrence.kind === "weekly") {
            setRecurrenceKind(recurrence.kind);
          }
          if (recurrence.interval_min != null) setIntervalMin(String(recurrence.interval_min));
          if (typeof recurrence.start_immediately === "boolean") setRecurrenceStartImmediately(recurrence.start_immediately);
          if (recurrence.start_at) setRecurrenceStartAt(toLocalDateTimeInput(recurrence.start_at));
          if (recurrence.time && recurrence.kind === "daily") setDailyTime(recurrence.time.slice(0, 5));
          if (recurrence.time && recurrence.kind === "weekly") setWeeklyTime(recurrence.time.slice(0, 5));
          if (recurrence.every_n_days != null) setDailyEvery(String(recurrence.every_n_days));
          if (Array.isArray(recurrence.weekdays) && recurrence.weekdays.length) setWeeklyDays(recurrence.weekdays);
          if (recurrence.every_n_weeks != null) setWeeklyEvery(String(recurrence.every_n_weeks));
        }

        // Param inputs: start from param_values, fallback to schema defaults
        const init: Record<string, string> = {};
        for (const [k, schema] of Object.entries(p.param_schema ?? {})) {
          const v =
            p.param_values?.[k] ??
            (schema.default !== undefined ? schema.default : paramKind(schema) === "bool" ? false : "");
          init[k] = paramInputValue(v, schema);
        }
        setParamInputs(init);

        setConfigTitle(p.config_meta?.title ?? p.name);
        setConfigTags((p.tags ?? []).join(","));
      } catch (e: any) {
        showToast("Panel load failed", e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [panelId, showToast]);

  const schemaEntries = useMemo(() => Object.entries(panel?.param_schema ?? {}), [panel]);
  const advancedSummary = useMemo(() => {
    const parts: string[] = [];
    if (priority !== 3) parts.push(`Priority ${priority}`);
    if (scheduleType === "TIMED") parts.push(scheduledAt ? `Timed ${scheduledAt}` : "Timed");
    if (scheduleType === "RECURRING") parts.push(`Recurring ${recurrenceKind}`);
    if (scheduleType !== "NOW") parts.push(scheduleTimezone);
    return parts.length > 0 ? parts.join(" · ") : "Default queue behavior";
  }, [dailyTime, intervalMin, priority, recurrenceKind, scheduleTimezone, scheduleType, scheduledAt]);
  const advancedControlWidth = 200;
  const advancedLabelWidth = 72;

  function openDataViewer(rid: number, datasetName?: string) {
    const tabId = uid("tab");
    const frame = createWindowFrame("dataViewer");
    addWindow({
      windowId: uid("win"),
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      locked: false,
      tabs: [
        {
          tabId,
          title: datasetName ? `Data: ${datasetName}` : `Run ${rid}`,
          view: "dataViewer",
          props: { rid, datasetName: datasetName ?? "" },
        },
      ],
      activeTabId: tabId,
    } as any);
  }

  // Convert the editable form state into the backend argument payload expected by queued runs.
  function buildParamValues(base: Record<string, string>) {
    if (!panel) return null;

    const out: Record<string, any> = {};
    for (const [k, field] of Object.entries(panel.param_schema ?? {})) {
      const raw = base[k] ?? "";
      const v = coerceValue(raw, field);
      if (v === null || v === undefined) continue;
      out[k] = v;
    }
    return out;
  }

  function getParamValidationErrors(base: Record<string, string>) {
    if (!panel) return [];
    const errors: string[] = [];
    for (const [k, field] of Object.entries(panel.param_schema ?? {})) {
      const raw = base[k] ?? "";
      const error = validateParamInput(k, raw, field);
      if (error) errors.push(error);
    }
    return errors;
  }

  function alertInvalidParams(errors: string[]) {
    if (!errors.length) return;
    window.alert(`Please fix the invalid parameter values before continuing.\n\n${errors.join("\n")}`);
  }

  function updateParamInput(name: string, value: string) {
    setParamInputs((s) => ({ ...s, [name]: value }));
  }

  function updateScanParam(name: string, field: ParamSchemaField, updater: (scan: ScanObject) => ScanObject) {
    setParamInputs((s) => {
      const current = parseScanInput(s[name] ?? "", field);
      return { ...s, [name]: JSON.stringify(updater(current)) };
    });
  }

  function renderNumberInput(name: string, raw: string, field: ParamSchemaField, width: number | string = 132) {
    const step = field.step != null ? field.step / scaleFor(field) : numericMode(field) === "int" ? 1 : "any";
    const min = field.min != null ? field.min / scaleFor(field) : undefined;
    const max = field.max != null ? field.max / scaleFor(field) : undefined;
    return (
      <TextField
        size="small"
        value={raw}
        onChange={(e) => updateParamInput(name, e.target.value)}
        type="number"
        InputProps={unitInputProps(field)}
        inputProps={{ step, min, max }}
        sx={{ width: { xs: "100%", sm: width } }}
      />
    );
  }

  function renderScannableInput(name: string, raw: string, field: ParamSchemaField) {
    const scan = parseScanInput(raw, field);
    const numberFieldSx = { width: { xs: "100%", sm: field.unit ? 118 : 92 } };
    const scanNumberInputProps = unitInputProps(field);
    const scanStep = field.global_step != null ? field.global_step / scaleFor(field) : field.step != null ? field.step / scaleFor(field) : "any";
    const scanMin = field.global_min != null ? field.global_min / scaleFor(field) : field.min != null ? field.min / scaleFor(field) : undefined;
    const scanMax = field.global_max != null ? field.global_max / scaleFor(field) : field.max != null ? field.max / scaleFor(field) : undefined;
    const scanInputProps = { step: scanStep, min: scanMin, max: scanMax };
    const updateNumber = (key: keyof ScanObject, value: string) => {
      updateScanParam(name, field, (current) => {
        const next = { ...current };
        const parsed = unscaleScanNumber(value, field);
        if (parsed === null) delete next[key];
        else (next as Record<string, unknown>)[key] = parsed;
        return next;
      });
    };
    const updateInt = (key: keyof ScanObject, value: string) => {
      updateScanParam(name, field, (current) => {
        const next = { ...current };
        const parsed = parseOptionalInteger(value);
        if (parsed === null) delete next[key];
        else (next as Record<string, unknown>)[key] = parsed;
        return next;
      });
    };
    const updateRandomize = (checked: boolean) => {
      updateScanParam(name, field, (current) => ({ ...current, randomize: checked }));
    };

    return (
      <Stack spacing={0.55} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.55} alignItems="center" flexWrap="wrap" useFlexGap>
          <Select
            size="small"
            value={scan.ty}
            disabled
            sx={{ width: { xs: "100%", sm: 132 } }}
          >
            <MenuItem value={scan.ty}>{scan.ty}</MenuItem>
          </Select>
          {scan.ty === "NoScan" && (
            <>
              <TextField
                size="small"
                label="Value"
                value={scaledScanNumber(scan.value, field)}
                onChange={(e) => updateNumber("value", e.target.value)}
                type="number"
                InputProps={scanNumberInputProps}
                inputProps={scanInputProps}
                sx={numberFieldSx}
              />
              <TextField
                size="small"
                label="Reps"
                value={scan.repetitions ?? ""}
                onChange={(e) => updateInt("repetitions", e.target.value)}
                type="number"
                inputProps={{ step: 1, min: 1 }}
                sx={numberFieldSx}
              />
            </>
          )}
          {scan.ty === "RangeScan" && (
            <>
              <TextField size="small" label="Start" value={scaledScanNumber(scan.start, field)} onChange={(e) => updateNumber("start", e.target.value)} type="number" InputProps={scanNumberInputProps} inputProps={scanInputProps} sx={numberFieldSx} />
              <TextField size="small" label="Stop" value={scaledScanNumber(scan.stop, field)} onChange={(e) => updateNumber("stop", e.target.value)} type="number" InputProps={scanNumberInputProps} inputProps={scanInputProps} sx={numberFieldSx} />
              <TextField size="small" label="Points" value={scan.npoints ?? ""} onChange={(e) => updateInt("npoints", e.target.value)} type="number" inputProps={{ step: 1, min: 1 }} sx={numberFieldSx} />
            </>
          )}
          {scan.ty === "CenterScan" && (
            <>
              <TextField size="small" label="Center" value={scaledScanNumber(scan.center, field)} onChange={(e) => updateNumber("center", e.target.value)} type="number" InputProps={scanNumberInputProps} inputProps={scanInputProps} sx={numberFieldSx} />
              <TextField size="small" label="Span" value={scaledScanNumber(scan.span, field)} onChange={(e) => updateNumber("span", e.target.value)} type="number" InputProps={scanNumberInputProps} inputProps={scanInputProps} sx={numberFieldSx} />
              <TextField size="small" label="Step" value={scaledScanNumber(scan.step, field)} onChange={(e) => updateNumber("step", e.target.value)} type="number" InputProps={scanNumberInputProps} inputProps={scanInputProps} sx={numberFieldSx} />
            </>
          )}
          {scan.ty === "ExplicitScan" && (
            <TextField
              size="small"
              label="Sequence"
              value={formatDisplayNumberList(scan.sequence, field)}
              onChange={(e) => updateScanParam(name, field, (current) => ({ ...current, sequence: parseDisplayNumberList(e.target.value, field) }))}
              placeholder="0, 0.5, 1.0"
              InputProps={scanNumberInputProps}
              sx={{ width: { xs: "100%", sm: field.unit ? 330 : 286 } }}
            />
          )}
        </Stack>
        {(scan.ty === "RangeScan" || scan.ty === "CenterScan") && (
          <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
            <Checkbox
              size="small"
              checked={Boolean(scan.randomize)}
              onChange={(e) => updateRandomize(e.target.checked)}
              sx={{ py: 0 }}
            />
            <Typography variant="caption" color="text.secondary">Randomize</Typography>
            <TextField
              size="small"
              label="Seed"
              value={scan.seed ?? ""}
              onChange={(e) => updateInt("seed", e.target.value)}
              type="number"
              inputProps={{ step: 1 }}
              sx={{ width: { xs: "100%", sm: 96 } }}
            />
          </Stack>
        )}
      </Stack>
    );
  }

  function parseCsvValues(s: string) {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }

  function buildQueueDefaults() {
    return {
      priority,
      schedule_type: scheduleType,
      scheduled_at: scheduleType === "TIMED" ? (scheduledAt || null) : null,
      interval_min: scheduleType === "RECURRING" && recurrenceKind === "interval" ? (intervalMin ? Number(intervalMin) : null) : null,
      timezone: scheduleTimezone,
      recurrence:
        scheduleType !== "RECURRING"
          ? null
          : recurrenceKind === "interval"
            ? {
                kind: "interval",
                interval_min: intervalMin ? Number(intervalMin) : null,
                start_immediately: recurrenceStartImmediately,
                start_at: recurrenceStartImmediately ? null : (recurrenceStartAt || null),
                timezone: scheduleTimezone,
              }
            : recurrenceKind === "daily"
              ? {
                  kind: "daily",
                  time: dailyTime || null,
                  every_n_days: dailyEvery ? Number(dailyEvery) : 1,
                  timezone: scheduleTimezone,
                }
              : {
                  kind: "weekly",
                  time: weeklyTime || null,
                  every_n_weeks: weeklyEvery ? Number(weeklyEvery) : 1,
                  weekdays: weeklyDays,
                  timezone: scheduleTimezone,
                },
    };
  }

  async function createOneRun(paramValuesOverride?: Record<string, any>) {
    if (!panel) return;

    let recurrence: Record<string, unknown> | null = null;
    if (scheduleType === "RECURRING") {
      if (recurrenceKind === "interval") {
        recurrence = {
          kind: "interval",
          interval_min: intervalMin ? Number(intervalMin) : null,
          start_immediately: recurrenceStartImmediately,
          start_at: recurrenceStartImmediately ? null : (recurrenceStartAt || null),
          timezone: scheduleTimezone,
        };
      } else if (recurrenceKind === "daily") {
        recurrence = {
          kind: "daily",
          time: dailyTime || null,
          every_n_days: dailyEvery ? Number(dailyEvery) : 1,
          timezone: scheduleTimezone,
        };
      } else {
        recurrence = {
          kind: "weekly",
          time: weeklyTime || null,
          every_n_weeks: weeklyEvery ? Number(weeklyEvery) : 1,
          weekdays: weeklyDays,
          timezone: scheduleTimezone,
        };
      }
    }

    const payload: any = {
      panel_id: panel.panel_id ?? panelId,
      script_path: panel.script_path,
      name: panel.name,
      priority,
      schedule_type: scheduleType,
      scheduled_at: scheduleType === "TIMED" ? (scheduledAt || null) : null,
      interval_min: scheduleType === "RECURRING" && recurrenceKind === "interval" ? (intervalMin ? Number(intervalMin) : null) : null,
      timezone: scheduleTimezone,
      recurrence,
      refresh_dataset: true,
    };

    if (paramValuesOverride && Object.keys(paramValuesOverride).length > 0) {
      payload.param_values = paramValuesOverride;
    }

    const resp = await api.createRun(payload);
    return resp;
  }

  async function syncPanelParams(paramValues: Record<string, any>) {
    if (!panel) return;
    try {
      const updated = await api.updatePanel(panel.panel_id ?? panelId, {
        param_values: paramValues,
        schedule_defaults: buildQueueDefaults(),
      } as any);
      setPanel(updated);
    } catch (e: any) {
      // Non-fatal: run/config can still proceed even if panel update fails.
      showToast("Panel update failed", e.message || String(e));
    }
  }

  async function onLaunch() {
    if (!panel) return;

    try {
      const validationErrors = getParamValidationErrors(paramInputs);
      if (validationErrors.length) {
        alertInvalidParams(validationErrors);
        return;
      }

      setLoading(true);

      const baseParamValues = buildParamValues(paramInputs) ?? {};
      await syncPanelParams(baseParamValues);
      const resp: any = await createOneRun(baseParamValues);

      if (scheduleType === "NOW" && resp?.rid) {
        openDataViewer(resp.rid);
        showToast("Run queued", `Run created for ${panel.name}`);
      } else if (scheduleType === "TIMED") {
        showToast("Timed run scheduled", `rid=${resp?.rid ?? "-"} · ${scheduledAt || "-"}`);
      } else {
        showToast("Recurring schedule created", `rid=${resp?.rid ?? "-"}${resp?.schedule_id ? ` · ${resp.schedule_id}` : ""}`);
      }
    } catch (e: any) {
      showToast("Launch failed", e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onSaveConfig() {
    if (!panel) return;
    try {
      const validationErrors = getParamValidationErrors(paramInputs);
      if (validationErrors.length) {
        alertInvalidParams(validationErrors);
        return;
      }

      const param_values = buildParamValues(paramInputs) ?? {};
      await syncPanelParams(param_values);
      const title = configTitle.trim() || panel.name;
      const tags = parseCsvValues(configTags);
      const resp = await api.createPanelConfigFromPanel({
        panel_id: panel.panel_id ?? panelId,
        title,
        tags,
      });
      showToast("Config saved", resp.config_id);
      const updated = await api.getPanel(panel.panel_id ?? panelId);
      setPanel(updated);
      setSaveConfigOpen(false);
    } catch (e: any) {
      showToast("Save config failed", e.message || String(e));
    }
  }

  async function onUpdateConfig() {
    if (!panel?.config_id) return;
    try {
      const validationErrors = getParamValidationErrors(paramInputs);
      if (validationErrors.length) {
        alertInvalidParams(validationErrors);
        return;
      }

      const param_values = buildParamValues(paramInputs) ?? {};
      const queue_defaults = buildQueueDefaults();
      await syncPanelParams(param_values);
      const resp = await api.updatePanelConfigFromPanel(panel.config_id, {
        panel_id: panel.panel_id ?? panelId,
        mode: "overwrite",
        fields: ["param_values", "queue_defaults"],
        param_values,
        queue_defaults,
      });
      showToast("Config updated", resp.config_id);
    } catch (e: any) {
      showToast("Update config failed", e.message || String(e));
    }
  }

  async function onSaveAsNewConfig() {
    if (!panel) return;
    try {
      const validationErrors = getParamValidationErrors(paramInputs);
      if (validationErrors.length) {
        alertInvalidParams(validationErrors);
        return;
      }

      const param_values = buildParamValues(paramInputs) ?? {};
      await syncPanelParams(param_values);
      const title = configTitle.trim() || `${panel.name} (copy)`;
      const tags = parseCsvValues(configTags);
      const resp = await api.createPanelConfigFromPanel({
        panel_id: panel.panel_id ?? panelId,
        title,
        tags,
      });
      showToast("Config saved", resp.config_id);
      setSaveAsOpen(false);
    } catch (e: any) {
      showToast("Save config failed", e.message || String(e));
    }
  }

  if (loading && !panel) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">Loading panel…</Typography>
      </Paper>
    );
  }

  if (!panel) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">Panel not found.</Typography>
      </Paper>
    );
  }

  if (minimizedCard) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 0.75,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderRadius: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={panel.name}
          >
            {panel.name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 0.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={panel.script_path}
          >
            {panel.script_path}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} justifyContent="space-between">
          <Button variant="contained" onClick={onLaunch} disabled={loading}>
            Queue
          </Button>
          <Button variant="outlined" onClick={onRestore}>
            Return
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 0.75,
        "& .MuiButton-root": { minHeight: 24, px: 0.9, py: 0.2, fontSize: 11, textTransform: "none" },
        "& .MuiInputBase-input": { py: "3px", fontSize: 11.5 },
        "& .MuiSelect-select": { py: "3px", fontSize: 11.5 },
      }}
    >
      {windowId && tabId ? (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 0.25 }}>
          <IconButton
            size="small"
            onClick={() => minimizePanelTab(windowId, tabId)}
            sx={{
              p: 0.35,
              border: "1px solid var(--border)",
              borderRadius: "999px",
              background: "color-mix(in srgb, var(--panel2) 80%, transparent)",
              "&:hover": { background: "color-mix(in srgb, var(--panel2) 92%, transparent)" },
            }}
            title="Minimize this panel"
          >
            <MinimizeIcon fontSize="inherit" />
          </IconButton>
        </Stack>
      ) : null}

      {compact ? (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <Button variant="contained" onClick={onLaunch} disabled={loading}>
                Queue Run
              </Button>
            </Stack>
          </Stack>
        </Box>
      ) : (
      <Stack spacing={0.9} sx={{ mt: 0.75 }}>
        <Box
          sx={{
            border: "1px solid var(--border)",
            borderRadius: 2,
            p: 0.9,
            background: "color-mix(in srgb, var(--panel2) 58%, transparent)",
          }}
        >
          <Stack spacing={0.4}>
            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center" sx={{ mb: 0.2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, letterSpacing: 0.2 }}>
                Parameters
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {schemaEntries.length} field{schemaEntries.length === 1 ? "" : "s"}
              </Typography>
            </Stack>
            {schemaEntries.map(([k, field]) => {
              const raw = paramInputs[k] ?? "";
              const kind = paramKind(field);
              const typeLabel = kind === "number" ? `[${numericMode(field)}]` : field.type ? `[${field.type}]` : "";
              return (
                <Stack
                  key={k}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={0.5}
                  alignItems={{ xs: "flex-start", sm: kind === "scannable" ? "flex-start" : "center" }}
                  sx={{
                    py: 0.35,
                    borderTop: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                  }}
                >
                  <Typography variant="body2" sx={{ width: { xs: "100%", sm: 110 }, fontSize: 11.5, lineHeight: 1.2 }}>
                    {k} <Typography component="span" variant="caption" color="text.secondary">{typeLabel}</Typography>
                  </Typography>
                  {kind === "bool" ? (
                    <Checkbox
                      size="small"
                      checked={raw === "true" || raw === "1"}
                      onChange={(e) => updateParamInput(k, e.target.checked ? "true" : "false")}
                      sx={{ py: 0 }}
                    />
                  ) : kind === "enum" ? (
                    <Select
                      size="small"
                      value={raw}
                      onChange={(e) => updateParamInput(k, e.target.value)}
                      sx={{ width: { xs: "100%", sm: 180 } }}
                    >
                      {(field.choices ?? []).map((choice) => (
                        <MenuItem key={choice} value={choice}>{choice}</MenuItem>
                      ))}
                    </Select>
                  ) : kind === "number" ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.45, flexWrap: "wrap", minHeight: 26, flex: 1 }}>
                      {renderNumberInput(k, raw, field)}
                    </Box>
                  ) : kind === "scannable" ? (
                    renderScannableInput(k, raw, field)
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.45, flexWrap: "wrap", minHeight: 26, flex: 1 }}>
                      <TextField
                        size="small"
                        value={raw}
                        onChange={(e) => updateParamInput(k, e.target.value)}
                        type="text"
                        placeholder={kind === "iterable" ? "e.g. 0,0.5,1.0" : undefined}
                        sx={{ width: { xs: "100%", sm: 132 } }}
                      />
                    </Box>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </Box>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={0.5}>
          <Button size="small" variant="contained" onClick={onLaunch} disabled={loading}>
            Queue Run
          </Button>
          <Button size="small" variant={advancedOpen ? "contained" : "outlined"} onClick={() => setAdvancedOpen((v) => !v)}>
            {"Advanced settings"}
          </Button>
        </Stack>
      </Stack>
      )}
      <Dialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        maxWidth="xs"
        fullWidth={false}
        PaperProps={{ sx: { width: "min(420px, calc(100% - 24px))", m: 1.5 } }}
      >
        <DialogTitle sx={{ overflowWrap: "anywhere", pb: 1, borderBottom: "1px solid var(--border)", textAlign: "center" }}>
          Advanced settings
        </DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.1, pt: 1.5, overflowX: "hidden", textAlign: "center", justifyItems: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 280, textAlign: "center" }}>
            {advancedSummary}
          </Typography>
          <Stack spacing={1.2} sx={{ width: "100%", alignItems: "center" }}>
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" sx={{ width: "150%" }}>
              <Typography variant="body2" sx={{ width: advancedLabelWidth, fontSize: 14, textAlign: "right" }}>Priority</Typography>
              <TextField
                size="small"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                inputProps={{ step: 1 }}
                sx={{ width: 150 }}
              />
            </Stack>

            <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ width: "100%" }}>
              <Typography variant="body2" sx={{ width: advancedLabelWidth, fontSize: 14, textAlign: "right" }}>Schedule</Typography>
              <Select
                size="small"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                sx={{ width: 150 }}
              >
                <MenuItem value="NOW">NOW</MenuItem>
                <MenuItem value="TIMED">TIMED</MenuItem>
                <MenuItem value="RECURRING">RECURRING</MenuItem>
              </Select>
            </Stack>
            {scheduleType === "TIMED" && (
              <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                <Typography variant="body2" sx={{ fontSize: 11.5 }}>Scheduled time</Typography>
                <TextField
                  size="small"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  type="datetime-local"
                  sx={{ width: advancedControlWidth }}
                />
              </Stack>
            )}
            {scheduleType !== "NOW" ? (
              <Stack spacing={0.25} alignItems="center" sx={{ width: "100%" }}>
                <Typography variant="body2" sx={{ fontSize: 11.5 }}>Timezone</Typography>
                <Typography variant="caption" color="text.secondary">
                  {scheduleTimezone}
                </Typography>
              </Stack>
            ) : null}
            {scheduleType === "RECURRING" ? (
              <>
                <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                  <Typography variant="body2" sx={{ fontSize: 11.5 }}>Pattern</Typography>
                  <Select
                    size="small"
                    value={recurrenceKind}
                    onChange={(e) => setRecurrenceKind(e.target.value as RecurrenceKind)}
                    sx={{ width: advancedControlWidth }}
                  >
                    <MenuItem value="interval">Interval</MenuItem>
                    <MenuItem value="daily">Daily</MenuItem>
                    <MenuItem value="weekly">Weekly</MenuItem>
                  </Select>
                </Stack>
                {recurrenceKind === "interval" ? (
                  <>
                    <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                      <Typography variant="body2" sx={{ fontSize: 11.5 }}>Every</Typography>
                      <TextField
                        size="small"
                        value={intervalMin}
                        onChange={(e) => setIntervalMin(e.target.value)}
                        type="number"
                        inputProps={{ step: 1, min: 1 }}
                        placeholder="minutes"
                        sx={{ width: advancedControlWidth }}
                      />
                      <Typography variant="caption" color="text.secondary">minutes</Typography>
                    </Stack>
                    <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                      <Typography variant="body2" sx={{ fontSize: 11.5 }}>Start</Typography>
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <Button size="small" sx={{ width: 86 }} variant={recurrenceStartImmediately ? "contained" : "outlined"} onClick={() => setRecurrenceStartImmediately(true)}>
                          Now
                        </Button>
                        <Button size="small" sx={{ width: 86 }} variant={!recurrenceStartImmediately ? "contained" : "outlined"} onClick={() => setRecurrenceStartImmediately(false)}>
                          Later
                        </Button>
                      </Stack>
                      {!recurrenceStartImmediately ? (
                        <TextField size="small" type="datetime-local" value={recurrenceStartAt} onChange={(e) => setRecurrenceStartAt(e.target.value)} sx={{ width: advancedControlWidth }} />
                      ) : null}
                    </Stack>
                  </>
                ) : null}
                {recurrenceKind === "daily" ? (
                  <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                    <Typography variant="body2" sx={{ fontSize: 11.5 }}>Daily</Typography>
                    <TextField size="small" type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} sx={{ width: advancedControlWidth }} />
                    <Typography variant="caption" color="text.secondary">every</Typography>
                    <TextField size="small" type="number" value={dailyEvery} onChange={(e) => setDailyEvery(e.target.value)} inputProps={{ min: 1, step: 1 }} sx={{ width: advancedControlWidth }} />
                    <Typography variant="caption" color="text.secondary">day(s)</Typography>
                  </Stack>
                ) : null}
                {recurrenceKind === "weekly" ? (
                  <>
                    <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                      <Typography variant="body2" sx={{ fontSize: 11.5 }}>Weekly</Typography>
                      <TextField size="small" type="time" value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} sx={{ width: advancedControlWidth }} />
                      <Typography variant="caption" color="text.secondary">every</Typography>
                      <TextField size="small" type="number" value={weeklyEvery} onChange={(e) => setWeeklyEvery(e.target.value)} inputProps={{ min: 1, step: 1 }} sx={{ width: advancedControlWidth }} />
                      <Typography variant="caption" color="text.secondary">week(s)</Typography>
                    </Stack>
                    <Stack spacing={0.35} alignItems="center" sx={{ width: "100%" }}>
                      <Typography variant="body2" sx={{ fontSize: 11.5 }}>Days</Typography>
                      <Stack direction="row" spacing={0.4} flexWrap="wrap" justifyContent="center">
                        {WEEKDAY_LABELS.map((label, day) => {
                          const active = weeklyDays.includes(day);
                          return (
                            <Button
                              key={label}
                              size="small"
                              variant={active ? "contained" : "outlined"}
                              onClick={() =>
                                setWeeklyDays((prev) =>
                                  prev.includes(day) ? prev.filter((v) => v !== day) : [...prev, day].sort((a, b) => a - b)
                                )
                              }
                            >
                              {label}
                            </Button>
                          );
                        })}
                      </Stack>
                    </Stack>
                  </>
                ) : null}
              </>
            ) : null}

            <Box sx={{ pt: 0.35, display: "flex", justifyContent: "center", width: "100%" }}>
              {panel.config_id ? (
                <Stack direction="column" spacing={0.5} alignItems="center" sx={{ width: "100%" }}>
                  <Button size="small" variant="outlined" sx={{ width: advancedControlWidth }} onClick={onUpdateConfig}>
                    Update configuration
                  </Button>
                  <Button size="small" variant="outlined" sx={{ width: advancedControlWidth }} onClick={() => setSaveAsOpen(true)}>
                    Save as new configuration
                  </Button>
                </Stack>
              ) : (
                <Button size="small" variant="outlined" sx={{ width: advancedControlWidth }} onClick={() => setSaveConfigOpen(true)}>
                  Save as configuration
                </Button>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "center", pb: 1.5 }}>
          <Button sx={{ width: advancedControlWidth }} onClick={() => setAdvancedOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={saveConfigOpen}
        onClose={() => setSaveConfigOpen(false)}
        maxWidth="xs"
        fullWidth={false}
        PaperProps={{ sx: { width: "min(440px, calc(100% - 24px))", m: 1.5 } }}
      >
        <DialogTitle sx={{ overflowWrap: "anywhere", pb: 1, borderBottom: "1px solid var(--border)" }}>
          Save configuration
        </DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.5, pt: 1.5, overflowX: "hidden" }}>
          <Box>
            <TextField
              size="small"
              value={configTitle}
              onChange={(e) => setConfigTitle(e.target.value)}
              placeholder="e.g. default calibration"
              fullWidth
            />
          </Box>
          <Box>
            <TextField
              size="small"
              value={configTags}
              onChange={(e) => setConfigTags(e.target.value)}
              placeholder="default, q1"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveConfigOpen(false)}>Cancel</Button>
          <Button variant="contained" sx={{ textTransform: "none" }} onClick={onSaveConfig}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={saveAsOpen}
        onClose={() => setSaveAsOpen(false)}
        maxWidth="xs"
        fullWidth={false}
        PaperProps={{ sx: { width: "min(440px, calc(100% - 24px))", m: 1.5 } }}
      >
        <DialogTitle sx={{ overflowWrap: "anywhere", pb: 1, borderBottom: "1px solid var(--border)" }}>
          Save as new configuration
        </DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.5, pt: 1.5, overflowX: "hidden" }}>
          <Box>
            <TextField
              size="small"
              value={configTitle}
              onChange={(e) => setConfigTitle(e.target.value)}
              placeholder="e.g. default calibration copy"
              fullWidth
            />
          </Box>
          <Box>
            <TextField
              size="small"
              value={configTags}
              onChange={(e) => setConfigTags(e.target.value)}
              placeholder="default, q1"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveAsOpen(false)}>Cancel</Button>
          <Button variant="contained" sx={{ textTransform: "none" }} onClick={onSaveAsNewConfig}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
