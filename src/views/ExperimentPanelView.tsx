import { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material";
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
    fields?: Array<{ key: string; control: string; default?: any; unit?: string }>;
    schedule_defaults?: {
      priority?: number;
      schedule_type?: "NOW" | "TIMED" | "RECURRING";
      scheduled_at?: string | null;
      interval_min?: number | null;
    };
  };
};

type Priority = 1 | 2 | 3 | 4;
type ScheduleType = "NOW" | "TIMED" | "RECURRING";
type FloatRangeState = { enabled: boolean; start: string; end: string; step: string };

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function coerceValue(raw: string, field: ParamSchemaField) {
  if (field.type === "int") {
    if (raw.trim() === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.trunc(v) : null;
  }
  if (field.type === "float") {
    if (raw.trim() === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  }
  if (field.type === "bool") {
    return raw === "true";
  }
  if (field.type === "iterable") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      });
  }
  // string
  return raw;
}

export default function ExperimentPanelView({ panelId, compact }: { panelId: string; compact?: boolean }) {
  const showToast = useAppStore((s) => s.showToast);
  const addWindow = useAppStore((s) => s.addWindow);

  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PanelDTO | null>(null);

  // run config
  const [priority, setPriority] = useState<Priority>(3);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("NOW");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [intervalMin, setIntervalMin] = useState<string>("");

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
        if (defaults?.scheduled_at) setScheduledAt(defaults.scheduled_at);
        if (defaults?.interval_min != null) setIntervalMin(String(defaults.interval_min));

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
    addWindow({
      windowId: uid("win"),
      x: 220,
      y: 120,
      w: 700,
      h: 500,
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

  async function createOneRun(paramValuesOverride?: Record<string, any>) {
    if (!panel) return;

    const payload: any = {
      panel_id: panel.panel_id ?? panelId,
      script_path: panel.script_path,
      priority,
      schedule_type: scheduleType,
      scheduled_at: scheduleType === "TIMED" ? (scheduledAt || null) : null,
      interval_min: scheduleType === "RECURRING" ? (intervalMin ? Number(intervalMin) : null) : null,
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
      const updated = await api.updatePanel(panel.panel_id ?? panelId, { param_values: paramValues });
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

      // If backend returns rid, open run viewer
      if (resp?.rid) openDataViewer(resp.rid);
      showToast("Run queued", `Run created for ${panel.name}`);
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
      const queue_defaults = {
        priority,
        schedule_type: scheduleType,
        scheduled_at: scheduleType === "TIMED" ? (scheduledAt || null) : null,
        interval_min: scheduleType === "RECURRING" ? (intervalMin ? Number(intervalMin) : null) : null,
      };
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
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{panel.name}</Typography>
          <Typography variant="caption" color="text.secondary">{panel.script_path}</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">panel_id: {panel.panel_id ?? panelId}</Typography>
      </Stack>

      {compact ? (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <Button variant="contained" onClick={onLaunch} disabled={loading}>
                Queue Run
              </Button>
              <Typography variant="caption" color="text.secondary">
                {scheduleType === "NOW" ? "NOW" : scheduleType}
                {scheduleType === "TIMED" && scheduledAt ? ` · ${scheduledAt}` : ""}
                {scheduleType === "RECURRING" && intervalMin ? ` · every ${intervalMin} min` : ""}
              </Typography>
            </Stack>
          </Stack>
        </Box>
      ) : (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 0.95fr" }, gap: 0.65, mt: 0.65 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.35, display: "block" }}>
            Parameters
          </Typography>
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
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.35, display: "block" }}>
            Schedule / Run settings
          </Typography>

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="body2" sx={{ width: 80, fontSize: 11.5 }}>Priority</Typography>
              <Select size="small" value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
                <MenuItem value={4}>Critical</MenuItem>
                <MenuItem value={3}>High</MenuItem>
                <MenuItem value={2}>Normal</MenuItem>
                <MenuItem value={1}>Low</MenuItem>
              </Select>
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
                  placeholder="ISO timestamp, e.g. 2025-12-31T09:00:00Z"
                  sx={{ width: 205 }}
                />
              )}
              {scheduleType === "RECURRING" && (
                <TextField
                  size="small"
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(e.target.value)}
                  type="number"
                  inputProps={{ step: 1, min: 1 }}
                  placeholder="interval (min)"
                  sx={{ width: 108 }}
                />
              )}
            </Stack>

          </Stack>

          <Box sx={{ mt: 0.75 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.35, display: "block" }}>
              Configuration
            </Typography>
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
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Configuration title
            </Typography>
            <TextField
              size="small"
              value={configTitle}
              onChange={(e) => setConfigTitle(e.target.value)}
              placeholder="e.g. default calibration"
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Tags (CSV)
            </Typography>
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
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Configuration title
            </Typography>
            <TextField
              size="small"
              value={configTitle}
              onChange={(e) => setConfigTitle(e.target.value)}
              placeholder="e.g. default calibration copy"
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Tags (CSV)
            </Typography>
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
