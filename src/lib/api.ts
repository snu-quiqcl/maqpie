import type {
  ArchivesListResp,
  ArchiveDetailResp,
  DatasetDataResp,
  DatasetMetaResp,
  DatasetsListResp,
  FileItem,
  FileType,
  LoginResp,
  LogsResp,
  PanelCreateReq,
  PanelConfigListResp,
  PanelConfigCreateResp,
  PanelConfigUpdateResp,
  PanelResp,
  RunDetailResp,
  RunsListResp,
  ScriptInspectResp,
  RunListItem,
  RunStatus,
  Priority,
  DatasetBrief,
  TtlDevicesResp,
} from "./types";

const DEFAULT_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "http://localhost:8000/api";

function normalizeApiBase(raw?: string) {
  if (!raw) return "";
  let v = raw.trim();
  if (!v) return "";
  v = v.replace(/\/$/, "");
  if (v.startsWith("http://") || v.startsWith("https://")) {
    try {
      const u = new URL(v);
      if (!u.pathname || u.pathname === "/") u.pathname = "/api";
      return `${u.origin}${u.pathname}`.replace(/\/$/, "");
    } catch {
      return v;
    }
  }
  if (v === "api" || v === "/api") return "/api";
  return v;
}

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("auth_token", token);
  else localStorage.removeItem("auth_token");
}

function getUserId(): number | null {
  const raw = localStorage.getItem("user_id");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setUserId(userId: number | null) {
  if (userId == null) localStorage.removeItem("user_id");
  else localStorage.setItem("user_id", String(userId));
}

export function getApiBase() {
  const stored = localStorage.getItem("api_base") ?? DEFAULT_BASE;
  return normalizeApiBase(stored) || "";
}

export function setApiBase(v: string) {
  localStorage.setItem("api_base", normalizeApiBase(v));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;

  function headersToRecord(h?: HeadersInit): Record<string, string> {
    if (!h) return {};
    if (h instanceof Headers) {
      const out: Record<string, string> = {};
      h.forEach((v, k) => (out[k] = v));
      return out;
    }
    if (Array.isArray(h)) {
      const out: Record<string, string> = {};
      for (const [k, v] of h) out[k] = v;
      return out;
    }
    return h as Record<string, string>;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...headersToRecord(init.headers),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Token ${token}`;

  const resp = await fetch(url, { ...init, headers });
  if (resp.status === 204) return undefined as unknown as T;

  const text = await resp.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!resp.ok) {
        throw new Error(text.slice(0, 200));
      }
      throw new Error("Invalid JSON response from API.");
    }
  }

  if (!resp.ok) {
    const msg = (data && (data.detail || data.error || data.message)) || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data as T;
}

function normalizePriority(p?: number | string): Priority {
  if (typeof p === "number") {
    if (p >= 1 && p <= 4) return p as Priority;
  }
  if (typeof p === "string") {
    if (/^\d+$/.test(p)) {
      const n = Number(p);
      if (n >= 1 && n <= 4) return n as Priority;
    }
    const map: Record<string, Priority> = { LOW: 1, NORMAL: 2, HIGH: 3, CRITICAL: 4 };
    const v = map[p.toUpperCase()];
    if (v) return v;
  }
  return 2;
}

function normalizeStatus(s?: string): RunStatus {
  if (s === "QUEUED" || s === "RUNNING" || s === "COMPLETED" || s === "FAILED" || s === "CANCELLED" || s === "ABORTED") {
    return s;
  }
  return "FAILED";
}

export function normalizeRun(raw: any): RunDetailResp {
  const rid = raw?.rid ?? raw?.id ?? 0;
  const scriptPath = raw?.script_path ?? "";
  const name = raw?.name ?? raw?.script_name ?? scriptPath ?? `Run ${rid}`;
  const userId = typeof raw?.user === "number" ? raw.user : raw?.author?.user_id;
  const username = raw?.author?.username ?? (userId ? `user_${userId}` : "");

  const base: RunListItem = {
    rid,
    name,
    script_path: scriptPath,
    class_name: raw?.class_name ?? undefined,
    author: { user_id: userId ?? 0, username },
    priority: normalizePriority(raw?.priority),
    schedule_type: raw?.schedule_type ?? "NOW",
    scheduled_at: raw?.scheduled_at ?? null,
    interval_min: raw?.interval_min ?? null,
    status: normalizeStatus(raw?.status),
    created_at: raw?.created_at ?? "",
    started_at: raw?.started_at ?? null,
    ended_at: raw?.ended_at ?? raw?.completed_at ?? null,
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    description: raw?.description,
  };

  return {
    ...base,
    parameters_schema: raw?.parameters_schema,
    param_values: raw?.param_values ?? raw?.arguments,
  };
}

function normalizeDataset(ds: any): DatasetBrief {
  const id = ds?.dataset_id ?? ds?.id;
  const datasetId = id != null ? String(ds?.dataset_id ?? `ds_${id}`) : "";
  const meta = ds?.metadata ?? {};
  return {
    dataset_id: datasetId,
    name: ds?.name ?? "",
    dtype: ds?.dtype ?? meta?.dtype ?? "unknown",
    shape: ds?.shape ?? meta?.shape ?? [],
    updated_at: ds?.updated_at ?? ds?.created_at ?? "",
  };
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<LoginResp>("/login/", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<void>("/logout/", { method: "POST", body: JSON.stringify({}) }),

  // Files
  listFiles: (type: FileType, path?: string) => {
    const qs = new URLSearchParams({ type, ...(path ? { path } : {}) }).toString();
    return request<{ type: FileType; path: string; items: FileItem[] }>(`/files/?${qs}`);
  },
  readFile: (type: FileType, path: string) => {
    const qs = new URLSearchParams({ type, path }).toString();
    return request<{ path: string; content: string }>(`/files/read/?${qs}`);
  },

  // Scripts
  inspectScript: (path: string) =>
    request<ScriptInspectResp>("/scripts/inspect/", { method: "POST", body: JSON.stringify({ path }) }),

  // Panels
  createPanel: (req: PanelCreateReq) =>
    request<PanelResp>("/panels/", { method: "POST", body: JSON.stringify(req) }),
  inspectPanelClasses: (script_path: string) =>
    request<{ script_path: string; classes: string[] }>("/panels/inspect-classes/", {
      method: "POST",
      body: JSON.stringify({ script_path }),
    }),
  listPanels: (query?: Record<string, string>) => {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
    return request<{ items: unknown[]; next_cursor: string | null }>(`/panels/${qs}`);
  },
  getPanel: (panel_id: string) => request<PanelResp>(`/panels/${panel_id}/`),
  updatePanel: (panel_id: string, body: Partial<PanelResp>) =>
    request<PanelResp>(`/panels/${panel_id}/`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePanel: (panel_id: string) => request<void>(`/panels/${panel_id}/`, { method: "DELETE" }),
  listPanelConfigs: (query?: Record<string, string>) => {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
    return request<PanelConfigListResp>(`/panel-configs/${qs}`);
  },
  createPanelConfigFromPanel: (body: { panel_id: string; title: string; tags?: string[] }) =>
    request<PanelConfigCreateResp>("/panel-configs/from-panel/", { method: "POST", body: JSON.stringify(body) }),
  updatePanelConfigFromPanel: (
    config_id: string,
    body: {
      panel_id: string;
      mode?: "overwrite";
      fields?: string[];
      param_values?: Record<string, unknown>;
      queue_defaults?: { priority?: number; schedule_type?: string; scheduled_at?: string | null; interval_min?: number | null };
    }
  ) =>
    request<PanelConfigUpdateResp>(`/panel-configs/${config_id}/apply-panel/`, { method: "POST", body: JSON.stringify(body) }),
  renamePanelConfig: (config_id: string, title: string) =>
    request<PanelConfigUpdateResp>(`/panel-configs/${config_id}/`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deletePanelConfig: (config_id: string) =>
    request<void>(`/panel-configs/${config_id}/`, { method: "DELETE" }),
  openPanelFromConfig: (config_id: string) =>
    request<PanelResp>("/panels/from-config/", { method: "POST", body: JSON.stringify({ config_id }) }),

  // Runs
  listRuns: async (query?: Record<string, string>): Promise<RunsListResp> => {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
    const resp = await request<unknown>(`/runs/${qs}`);
    if (Array.isArray(resp)) {
      return { items: resp.map(normalizeRun), next_cursor: null };
    }
    if (resp && typeof resp === "object") {
      const items = Array.isArray((resp as any).items) ? (resp as any).items.map(normalizeRun) : [];
      return { items, next_cursor: (resp as any).next_cursor ?? null };
    }
    return { items: [], next_cursor: null };
  },
  createRun: async (body: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { ...body };
    if (payload.param_values && !payload.arguments) payload.arguments = payload.param_values;
    const userId = getUserId();
    if (userId && payload.user == null) payload.user = userId;

    const allowedKeys = new Set([
      "panel_id",
      "script",
      "script_path",
      "arguments",
      "user",
      "status",
      "priority",
      "schedule_type",
      "scheduled_at",
      "interval_min",
    ]);
    for (const k of Object.keys(payload)) {
      if (!allowedKeys.has(k)) delete payload[k];
    }
    const resp = await request<unknown>("/runs/", { method: "POST", body: JSON.stringify(payload) });
    return normalizeRun(resp);
  },
  getRun: async (rid: number) => {
    const resp = await request<unknown>(`/runs/${rid}/`);
    return normalizeRun(resp);
  },
  abortRun: (rid: number) => request<{ rid: number; status: string }>(`/runs/${rid}/abort/`, { method: "POST", body: JSON.stringify({}) }),
  deleteRun: (rid: number) => request<void>(`/runs/${rid}/`, { method: "DELETE" }),

  // Data
  listDatasets: async (rid: number) => {
    const resp = await request<unknown>(`/runs/${rid}/datasets/`);
    if (Array.isArray(resp)) {
      return { rid, datasets: resp.map(normalizeDataset) } satisfies DatasetsListResp;
    }
    if (resp && typeof resp === "object" && Array.isArray((resp as any).datasets)) {
      return { rid, datasets: (resp as any).datasets.map(normalizeDataset) } satisfies DatasetsListResp;
    }
    return { rid, datasets: [] } satisfies DatasetsListResp;
  },
  getDatasetMeta: async (rid: number, dataset_name: string) => {
    const resp = await request<any>(`/runs/${rid}/datasets/${encodeURIComponent(dataset_name)}/meta/`);
    if (resp?.metadata) {
      return {
        ...resp,
        units: resp.units ?? resp.metadata?.units,
        parameters: resp.parameters ?? resp.metadata?.parameters,
        hints: resp.hints ?? resp.metadata?.hints,
      } as DatasetMetaResp;
    }
    return resp as DatasetMetaResp;
  },
  getDatasetData: (rid: number, dataset_name: string, opts?: { format?: string; slice?: string }) => {
    const qs = opts ? `?${new URLSearchParams(opts as Record<string, string>).toString()}` : "";
    return request<DatasetDataResp>(`/runs/${rid}/datasets/${encodeURIComponent(dataset_name)}/data/${qs}`);
  },

  // Logs
  getLogs: (rid: number, from_seq?: number) => {
    const qs = from_seq != null ? `?${new URLSearchParams({ from_seq: String(from_seq) }).toString()}` : "";
    return request<LogsResp>(`/runs/${rid}/logs/${qs}`);
  },

  // TTL
  getTtlDevices: () => request<TtlDevicesResp>("/ttl/devices/"),
  setTtlLevel: (devices: string[], levels: string[]) =>
    request<{ ok: boolean }>("/ttl/level/", { method: "POST", body: JSON.stringify({ devices, levels }) }),
  setTtlOverride: (devices: string[], values: boolean[]) =>
    request<{ ok: boolean }>("/ttl/override/", { method: "POST", body: JSON.stringify({ devices, values }) }),

  // Archives
  createArchive: (body: unknown) => request<{ archive_id: number; created_at: string }>("/archives/", { method: "POST", body: JSON.stringify(body) }),
  listArchives: (query?: Record<string, string>) => {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
    return request<ArchivesListResp>(`/archives/${qs}`);
  },
  getArchive: (archive_id: number) => request<ArchiveDetailResp>(`/archives/${archive_id}/`),
  updateArchive: (archive_id: number, body: Record<string, unknown>) =>
    request<ArchiveDetailResp>(`/archives/${archive_id}/`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteArchive: (archive_id: number) =>
    request<void>(`/archives/${archive_id}/`, { method: "DELETE" }),
  getArchivedDatasetData: (archive_id: number, dataset_name: string, opts?: { format?: string; slice?: string }) => {
    const qs = opts ? `?${new URLSearchParams(opts as Record<string, string>).toString()}` : "";
    return request<DatasetDataResp>(`/archives/${archive_id}/datasets/${encodeURIComponent(dataset_name)}/data/${qs}`);
  },
};

// WebSocket URL helper
export function wsUrl(path: string) {
  const base = getApiBase();
  const token = getToken();
  // If base is http(s)://host, convert to ws(s)://host
  const u = new URL(base || window.location.origin);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  const host = `${proto}//${u.host}`;
  const full = `${host}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token || "")}`;
  return full;
}
