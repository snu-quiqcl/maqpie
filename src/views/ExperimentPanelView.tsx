import { useEffect, useMemo, useState } from "react";
import { createWindowFrame } from "../lib/windowFrame";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material";
import MinimizeIcon from "@mui/icons-material/Minimize";
import { api } from "../lib/api";
import { useAppStore } from "../state/store";

type ParamSchemaField = {
  type: "int" | "float" | "string" | "bool" | "iterable";
  default?: any;
  min?: number;
  max?: number;
  unit?: string;
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
  parameters_schema: Record<string, ParamSchemaField>;
  param_values: Record<string, any>;
  panel?: {
    fields?: Array<{ key: string; control: string }>;
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
type FloatRangeState = { enabled: boolean; start: string; end: string; step: string };
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

function coerceValue(raw: string, field: ParamSchemaField) {
  const value = String(raw ?? "").trim();
  if (field.type === "bool") return value === "true" || value === "1";
  if (value.length === 0) return null;
  if (field.type === "int") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "float") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "iterable") {
    const items = value.split(",").map((part) => part.trim()).filter(Boolean);
    return items.length ? items : null;
  }
  return value;
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
  const [floatRanges, setFloatRanges] = useState<Record<string, FloatRangeState>>({});

  const [configTitle, setConfigTitle] = useState<string>("");
  const [configTags, setConfigTags] = useState<string>("");
  const [saveConfigOpen, setSaveConfigOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
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
        const ranges: Record<string, FloatRangeState> = {};
        const panelSweepKeys = new Set(
          (p.panel?.fields ?? [])
            .filter((f) => String(f.control ?? "").toLowerCase() === "sweep")
            .map((f) => f.key)
        );
        for (const [k, schema] of Object.entries(p.parameters_schema ?? {})) {
          const v =
            p.param_values?.[k] ??
            (schema.default !== undefined ? schema.default : schema.type === "bool" ? false : "");
          init[k] = String(v);
          if (panelSweepKeys.has(k)) {
            ranges[k] = { enabled: false, start: String(v ?? ""), end: String(v ?? ""), step: "0.1" };
          }
        }
        setParamInputs(init);
        setFloatRanges(ranges);

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

  const schemaEntries = useMemo(() => Object.entries(panel?.parameters_schema ?? {}), [panel]);
  const sweepKeys = useMemo(
    () =>
      new Set(
        (panel?.panel?.fields ?? [])
          .filter((f) => String(f.control ?? "").toLowerCase() === "sweep")
          .map((f) => f.key)
      ),
    [panel]
  );

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
    for (const [k, field] of Object.entries(panel.parameters_schema ?? {})) {
      const isSweep = sweepKeys.has(k);
      if (isSweep && floatRanges[k]?.enabled) {
        const start = Number(floatRanges[k].start);
        const end = Number(floatRanges[k].end);
        const step = Number(floatRanges[k].step);
        if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(step) && step !== 0) {
          const values: number[] = [];
          const dir = step > 0 ? 1 : -1;
          for (let x = start; dir > 0 ? x <= end + 1e-12 : x >= end - 1e-12; x += step) {
            values.push(Number(x.toFixed(10)));
            if (values.length > 10000) break;
          }
          if (values.length > 0) {
            out[k] = values;
            continue;
          }
        }
      }
      const raw = base[k] ?? "";
      const v = coerceValue(raw, field);
      if (v === null || v === undefined) continue;
      out[k] = v;
    }
    return out;
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
        "& .MuiInputBase-input": { py: "4px", fontSize: 11.5 },
        "& .MuiSelect-select": { py: "4px", fontSize: 11.5 },
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={0.5} alignItems="center">
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{panel.name}</Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {windowId && tabId ? (
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
          ) : null}
        </Stack>
      </Stack>

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
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 0.95fr" }, gap: 0.65, mt: 0.65 }}>
        <Box>
          <Stack spacing={0.4}>
            {schemaEntries.map(([k, field]) => {
              const raw = paramInputs[k] ?? "";
              const unit = field.unit ? ` ${field.unit}` : "";
              const typeLabel = field.type ? `[${field.type}]` : "";
              const numeric = field.type === "int" || field.type === "float";
              const range = floatRanges[k];
              const isSweep = sweepKeys.has(k);
              return (
                <Stack key={k} direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="body2" sx={{ width: 80, fontSize: 11.5, lineHeight: 1.1 }}>
                    {k} <Typography component="span" variant="caption" color="text.secondary">{typeLabel}</Typography>
                  </Typography>
                  {field.type === "bool" ? (
                    <Checkbox
                      size="small"
                      checked={raw === "true" || raw === "1"}
                      onChange={(e) => setParamInputs((s) => ({ ...s, [k]: e.target.checked ? "true" : "false" }))}
                    />
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.45, flexWrap: "wrap", minHeight: 26 }}>
                      {!range?.enabled ? (
                        <TextField
                          size="small"
                          value={raw}
                          onChange={(e) => setParamInputs((s) => ({ ...s, [k]: e.target.value }))}
                          type={numeric ? "number" : "text"}
                          inputProps={{ step: field.type === "int" ? 1 : "any", min: field.min, max: field.max }}
                          placeholder={field.type === "iterable" ? "e.g. 0,0.5,1.0" : undefined}
                          sx={{ width: isSweep ? 92 : 132 }}
                        />
                      ) : null}
                      {isSweep ? (
                        <Button
                          size="small"
                          variant={range?.enabled ? "contained" : "outlined"}
                          onClick={() =>
                            setFloatRanges((prev) => ({
                              ...prev,
                              [k]: {
                                ...(prev[k] ?? { enabled: false, start: raw || "0", end: raw || "1", step: "0.1" }),
                                enabled: !(prev[k]?.enabled ?? false),
                              },
                            }))
                          }
                        >
                          Sweep
                        </Button>
                      ) : null}
                      {isSweep && range?.enabled ? (
                        <>
                          <TextField
                            size="small"
                            value={range.start}
                            onChange={(e) => setFloatRanges((prev) => ({ ...prev, [k]: { ...(prev[k] ?? range), start: e.target.value } }))}
                            placeholder="start"
                            inputProps={{ step: "any" }}
                            sx={{ width: 68 }}
                          />
                          <TextField
                            size="small"
                            value={range.end}
                            onChange={(e) => setFloatRanges((prev) => ({ ...prev, [k]: { ...(prev[k] ?? range), end: e.target.value } }))}
                            placeholder="end"
                            inputProps={{ step: "any" }}
                            sx={{ width: 68 }}
                          />
                          <TextField
                            size="small"
                            value={range.step}
                            onChange={(e) => setFloatRanges((prev) => ({ ...prev, [k]: { ...(prev[k] ?? range), step: e.target.value } }))}
                            placeholder="step"
                            inputProps={{ step: "any" }}
                            sx={{ width: 62 }}
                          />
                        </>
                      ) : null}
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 16 }}>{unit}</Typography>
                </Stack>
              );
            })}
          </Stack>

        </Box>

        <Box>

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Priority</Typography>
              <TextField
                size="small"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                inputProps={{ step: 1 }}
                sx={{ width: 112 }}
              />
            </Stack>

            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Schedule</Typography>
              <Select size="small" value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)}>
                <MenuItem value="NOW">NOW</MenuItem>
                <MenuItem value="TIMED">TIMED</MenuItem>
                <MenuItem value="RECURRING">RECURRING</MenuItem>
              </Select>
              {scheduleType === "TIMED" && (
                <TextField
                  size="small"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  type="datetime-local"
                  sx={{ width: 205, ml: 0.5 }}
                />
              )}
            </Stack>
            {scheduleType !== "NOW" ? (
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Timezone</Typography>
                <Typography variant="caption" color="text.secondary">
                  {scheduleTimezone}
                </Typography>
              </Stack>
            ) : null}
            {scheduleType === "RECURRING" ? (
              <>
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Pattern</Typography>
                  <Select size="small" value={recurrenceKind} onChange={(e) => setRecurrenceKind(e.target.value as RecurrenceKind)}>
                    <MenuItem value="interval">Interval</MenuItem>
                    <MenuItem value="daily">Daily</MenuItem>
                    <MenuItem value="weekly">Weekly</MenuItem>
                  </Select>
                </Stack>
                {recurrenceKind === "interval" ? (
                  <>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Every</Typography>
                      <TextField
                        size="small"
                        value={intervalMin}
                        onChange={(e) => setIntervalMin(e.target.value)}
                        type="number"
                        inputProps={{ step: 1, min: 1 }}
                        placeholder="minutes"
                        sx={{ width: 108 }}
                      />
                      <Typography variant="caption" color="text.secondary">minutes</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Start</Typography>
                      <Button size="small" variant={recurrenceStartImmediately ? "contained" : "outlined"} onClick={() => setRecurrenceStartImmediately(true)}>
                        Now
                      </Button>
                      <Button size="small" variant={!recurrenceStartImmediately ? "contained" : "outlined"} onClick={() => setRecurrenceStartImmediately(false)}>
                        Later
                      </Button>
                      {!recurrenceStartImmediately ? (
                        <TextField size="small" type="datetime-local" value={recurrenceStartAt} onChange={(e) => setRecurrenceStartAt(e.target.value)} sx={{ width: 205 }} />
                      ) : null}
                    </Stack>
                  </>
                ) : null}
                {recurrenceKind === "daily" ? (
                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                    <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Daily</Typography>
                    <TextField size="small" type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} sx={{ width: 112 }} />
                    <Typography variant="caption" color="text.secondary">every</Typography>
                    <TextField size="small" type="number" value={dailyEvery} onChange={(e) => setDailyEvery(e.target.value)} inputProps={{ min: 1, step: 1 }} sx={{ width: 72 }} />
                    <Typography variant="caption" color="text.secondary">day(s)</Typography>
                  </Stack>
                ) : null}
                {recurrenceKind === "weekly" ? (
                  <>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Weekly</Typography>
                      <TextField size="small" type="time" value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} sx={{ width: 112 }} />
                      <Typography variant="caption" color="text.secondary">every</Typography>
                      <TextField size="small" type="number" value={weeklyEvery} onChange={(e) => setWeeklyEvery(e.target.value)} inputProps={{ min: 1, step: 1 }} sx={{ width: 72 }} />
                      <Typography variant="caption" color="text.secondary">week(s)</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.4} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Days</Typography>
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
                  </>
                ) : null}
              </>
            ) : null}

          </Stack>

          <Box sx={{ mt: 0.75 }}>
            {panel.config_id ? (
              <Stack direction="row" spacing={0.5}>
                <Button size="small" variant="outlined" onClick={onUpdateConfig}>
                  Update configuration
                </Button>
                <Button size="small" variant="outlined" onClick={() => setSaveAsOpen(true)}>
                  Save as new configuration
                </Button>
              </Stack>
            ) : (
              <Button size="small" variant="outlined" onClick={() => setSaveConfigOpen(true)}>
                Save as configuration
              </Button>
            )}
          </Box>

          <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
            <Button size="small" variant="contained" onClick={onLaunch} disabled={loading}>
              Queue Run
            </Button>
            <Button size="small" variant="text" disabled>
              Save params
            </Button>
          </Stack>
        </Box>
      </Box>
      )}
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
