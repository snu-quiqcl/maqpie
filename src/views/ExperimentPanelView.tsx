import { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material";
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
  const addTabToWindow = useAppStore((s) => s.addTabToWindow);
  const bringToFront = useAppStore((s) => s.bringToFront);

  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PanelDTO | null>(null);

  // run config
  const [priority, setPriority] = useState<Priority>(3);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("NOW");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [intervalMin, setIntervalMin] = useState<string>("");

  // single-run parameter form
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});

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
        for (const [k, schema] of Object.entries(p.parameters_schema ?? {})) {
          const v =
            p.param_values?.[k] ??
            (schema.default !== undefined ? schema.default : schema.type === "bool" ? false : "");
          init[k] = String(v);
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

  const schemaEntries = useMemo(() => Object.entries(panel?.parameters_schema ?? {}), [panel]);

  function openDataViewer(rid: number, datasetName?: string) {
    const tabId = uid("tab");
    addWindow({
      windowId: uid("win"),
      x: 220,
      y: 120,
      w: 720,
      h: 540,
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

  async function onLaunch() {
    if (!panel) return;

    try {
      setLoading(true);

      const baseParamValues = buildParamValues(paramInputs) ?? {};
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
      const resp = await api.updatePanelConfigFromPanel(panel.config_id, {
        panel_id: panel.panel_id ?? panelId,
        mode: "overwrite",
        fields: ["param_values", "queue_defaults"],
      });
      showToast("Config updated", resp.config_id);
    } catch (e: any) {
      showToast("Update config failed", e.message || String(e));
    }
  }

  async function onSaveAsNewConfig() {
    if (!panel) return;
    try {
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
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
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
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 1.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            Parameters
          </Typography>
          <Stack spacing={1}>
            {schemaEntries.map(([k, field]) => {
              const raw = paramInputs[k] ?? "";
              const unit = field.unit ? ` ${field.unit}` : "";
              const numeric = field.type === "int" || field.type === "float";
              return (
                <Stack key={k} direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" sx={{ width: 120 }}>{k}</Typography>
                  {field.type === "bool" ? (
                    <Checkbox
                      size="small"
                      checked={raw === "true" || raw === "1"}
                      onChange={(e) => setParamInputs((s) => ({ ...s, [k]: e.target.checked ? "true" : "false" }))}
                    />
                  ) : (
                    <TextField
                      size="small"
                      value={raw}
                      onChange={(e) => setParamInputs((s) => ({ ...s, [k]: e.target.value }))}
                      type={numeric ? "number" : "text"}
                      inputProps={{ step: field.type === "int" ? 1 : "any", min: field.min, max: field.max }}
                      placeholder={field.type === "iterable" ? "e.g. 0, 0.5, 1.0" : undefined}
                      sx={{ width: 220 }}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary">{unit}</Typography>
                </Stack>
              );
            })}
          </Stack>

        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            Schedule / Run settings
          </Typography>

          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ width: 120 }}>Priority</Typography>
              <Select size="small" value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
                <MenuItem value={4}>Critical</MenuItem>
                <MenuItem value={3}>High</MenuItem>
                <MenuItem value={2}>Normal</MenuItem>
                <MenuItem value={1}>Low</MenuItem>
              </Select>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" sx={{ width: 120 }}>Schedule</Typography>
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
                  sx={{ width: 320 }}
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
                  sx={{ width: 160 }}
                />
              )}
            </Stack>

          </Stack>

          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
              Configuration
            </Typography>
            {panel.config_id ? (
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" onClick={onUpdateConfig}>
                  Update configuration
                </Button>
                <Button variant="outlined" onClick={() => setSaveAsOpen(true)}>
                  Save as new configuration
                </Button>
              </Stack>
            ) : (
              <Button variant="outlined" onClick={() => setSaveConfigOpen(true)}>
                Save as configuration
              </Button>
            )}
          </Box>

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
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
      <Dialog open={saveConfigOpen} onClose={() => setSaveConfigOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save configuration</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.5, pt: 1 }}>
          <TextField
            size="small"
            label="Config title"
            value={configTitle}
            onChange={(e) => setConfigTitle(e.target.value)}
          />
          <TextField
            size="small"
            label="Config tags (CSV)"
            value={configTags}
            onChange={(e) => setConfigTags(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveConfigOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onSaveConfig}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={saveAsOpen} onClose={() => setSaveAsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save as new configuration</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.5, pt: 1 }}>
          <TextField
            size="small"
            label="Config title"
            value={configTitle}
            onChange={(e) => setConfigTitle(e.target.value)}
          />
          <TextField
            size="small"
            label="Config tags (CSV)"
            value={configTags}
            onChange={(e) => setConfigTags(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveAsOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onSaveAsNewConfig}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
