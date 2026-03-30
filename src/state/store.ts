// src/state/store.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createWindowFrame } from "../lib/windowFrame";

export type ViewType = "runsManager" | "fileExplorer" | "experimentPanel" | "dataViewer" | "archives" | "panelConfigs" | "ttlControls";

export type TabModel = {
  tabId: string;
  title: string;
  view: ViewType;
  props: Record<string, unknown>;
};

export type WindowModel = {
  windowId: string;
  workspaceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  tabs: TabModel[];
  activeTabId: string;
  locked?: boolean; // "locked" = cannot close window (singleton); still resizable/movable
  minimized?: boolean;
};

export type MinimizedPanelModel = {
  minimizedId: string;
  workspaceId: string;
  tab: TabModel;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  sourceWindowId?: string;
};

export type Toast = { id: string; title: string; message: string; ts: number };

// Zustand keeps the desktop layout serializable so the UI can be restored across reloads.
type AppState = {
  apiBase: string;
  username: string | null;

  activeWorkspaceId: string;
  windows: WindowModel[];
  minimizedPanels: MinimizedPanelModel[];
  nextZ: number;

  toast: Toast | null;

  setApiBase: (v: string) => void;
  setUsername: (u: string | null) => void;
  setActiveWorkspaceId: (workspaceId: string) => void;

  bringToFront: (windowId: string) => void;
  moveResizeWindow: (windowId: string, patch: Partial<Pick<WindowModel, "x" | "y" | "w" | "h">>) => void;
  bringMinimizedPanelToFront: (minimizedId: string) => void;
  moveMinimizedPanel: (minimizedId: string, patch: Partial<Pick<MinimizedPanelModel, "x" | "y">>) => void;

  addWindow: (win: Omit<WindowModel, "z" | "workspaceId">) => void;
  closeWindow: (windowId: string) => void;
  toggleWindowMinimized: (windowId: string) => void;
  minimizePanelTab: (windowId: string, tabId: string) => void;
  restoreMinimizedPanel: (minimizedId: string) => void;

  addTabToWindow: (windowId: string, tab: TabModel, activate?: boolean) => void;
  closeTab: (windowId: string, tabId: string) => void;
  setActiveTab: (windowId: string, tabId: string) => void;

  mergeTabIntoWindow: (fromWindowId: string, tabId: string, toWindowId: string) => void;
  detachTab: (windowId: string, tabId: string) => void;

  openOrFocusSingletonRunsManager: () => void;
  openOrFocusSingletonFileExplorer: () => void;

  showToast: (title: string, message: string) => void;
  clearToast: () => void;

  persist: () => void;
  rehydrate: () => void;
};

const LS_KEY = "lab_ui_layout_v1";
const DEFAULT_WORKSPACE_ID = "workspace_main";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function runsManagerWindowId(workspaceId: string) {
  return workspaceId === DEFAULT_WORKSPACE_ID ? "win_runs_manager" : `win_runs_manager_${workspaceId}`;
}

function fileExplorerWindowId(workspaceId: string) {
  return workspaceId === DEFAULT_WORKSPACE_ID ? "win_file_explorer" : `win_file_explorer_${workspaceId}`;
}

function toNumber(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeTab(t: any): TabModel | null {
  if (!t || typeof t !== "object") return null;
  if (!t.tabId || !t.view) return null;
  return {
    tabId: String(t.tabId),
    title: String(t.title ?? t.view),
    view: t.view,
    props: t.props && typeof t.props === "object" ? t.props : {},
  } as TabModel;
}

function sanitizeWindow(w: any): WindowModel | null {
  if (!w || typeof w !== "object") return null;
  const tabs = Array.isArray(w.tabs) ? w.tabs.map(sanitizeTab).filter(Boolean) as TabModel[] : [];
  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.tabId === w.activeTabId) ? w.activeTabId : tabs[0].tabId;
  const hasArchives = tabs.some((t) => t.view === "archives");
  return {
    windowId: String(w.windowId ?? uid("win")),
    // Older saved layouts predate workspaces, so we fold them into Main.
    workspaceId: String(w.workspaceId ?? DEFAULT_WORKSPACE_ID),
    x: toNumber(w.x, 40),
    y: toNumber(w.y, 80),
    w: toNumber(w.w, 520),
    h: toNumber(w.h, 360),
    z: toNumber(w.z, 1),
    locked: hasArchives ? false : Boolean(w.locked),
    minimized: Boolean(w.minimized),
    tabs,
    activeTabId: active,
  };
}

function sanitizeMinimizedPanel(p: any): MinimizedPanelModel | null {
  if (!p || typeof p !== "object") return null;
  const tab = sanitizeTab(p.tab);
  if (!tab || tab.view !== "experimentPanel") return null;
  return {
    minimizedId: String(p.minimizedId ?? uid("mini")),
    // Older saved layouts predate workspaces, so we fold them into Main.
    workspaceId: String(p.workspaceId ?? DEFAULT_WORKSPACE_ID),
    tab,
    x: toNumber(p.x, 80),
    y: toNumber(p.y, 120),
    w: toNumber(p.w, 188),
    h: toNumber(p.h, 132),
    z: toNumber(p.z, 1),
    sourceWindowId: p.sourceWindowId ? String(p.sourceWindowId) : undefined,
  };
}

/** Singleton: Experiment Manager */
function defaultRunsManager(): WindowModel {
  const tabId = uid("tab");
  const frame = createWindowFrame("runsManager");
  return {
    windowId: runsManagerWindowId(DEFAULT_WORKSPACE_ID),
    workspaceId: DEFAULT_WORKSPACE_ID,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    z: 1,
    locked: true,
    tabs: [{ tabId, title: "Experiment Manager", view: "runsManager", props: {} }],
    activeTabId: tabId,
  };
}

function defaultRunsManagerForWorkspace(workspaceId: string): WindowModel {
  const tabId = uid("tab");
  const frame = createWindowFrame("runsManager");
  return {
    windowId: runsManagerWindowId(workspaceId),
    workspaceId,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    z: 1,
    locked: true,
    tabs: [{ tabId, title: "Experiment Manager", view: "runsManager", props: {} }],
    activeTabId: tabId,
  };
}

/** Singleton: File Explorer (defaults to your scripts directory) */
function defaultFileExplorer(): WindowModel {
  const tabId = uid("tab");
  const frame = createWindowFrame("fileExplorer");
  return {
    windowId: fileExplorerWindowId(DEFAULT_WORKSPACE_ID),
    workspaceId: DEFAULT_WORKSPACE_ID,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    z: 1,
    locked: true,
    tabs: [
      {
        tabId,
        title: "File Explorer",
        view: "fileExplorer",
        props: { defaultPath: "" },
      },
    ],
    activeTabId: tabId,
  };
}

function defaultFileExplorerForWorkspace(workspaceId: string): WindowModel {
  const tabId = uid("tab");
  const frame = createWindowFrame("fileExplorer");
  return {
    windowId: fileExplorerWindowId(workspaceId),
    workspaceId,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    z: 1,
    locked: true,
    tabs: [
      {
        tabId,
        title: "File Explorer",
        view: "fileExplorer",
        props: { defaultPath: "" },
      },
    ],
    activeTabId: tabId,
  };
}


export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    apiBase: localStorage.getItem("api_base") ?? "",
    username: localStorage.getItem("username") ?? null,

    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    windows: [],
    minimizedPanels: [],
    nextZ: 2,
    toast: null,

    setApiBase: (v) => {
      set((s) => void (s.apiBase = v));
      localStorage.setItem("api_base", v);
    },
    setUsername: (u) => {
      set((s) => void (s.username = u));
      if (u) localStorage.setItem("username", u);
      else localStorage.removeItem("username");
    },
    setActiveWorkspaceId: (workspaceId) => {
      set((s) => void (s.activeWorkspaceId = workspaceId || DEFAULT_WORKSPACE_ID));
    },

    bringToFront: (windowId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        w.z = s.nextZ++;
      });
      get().persist();
    },

    moveResizeWindow: (windowId, patch) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        Object.assign(w, patch);
      });
      get().persist();
    },

    bringMinimizedPanelToFront: (minimizedId) => {
      set((s) => {
        const p = s.minimizedPanels.find((x) => x.minimizedId === minimizedId);
        if (!p) return;
        p.z = s.nextZ++;
      });
      get().persist();
    },

    moveMinimizedPanel: (minimizedId, patch) => {
      set((s) => {
        const p = s.minimizedPanels.find((x) => x.minimizedId === minimizedId);
        if (!p) return;
        Object.assign(p, patch);
      });
      get().persist();
    },

    addWindow: (win) => {
      set((s) => {
        // New windows belong to whichever workspace is currently active.
        s.windows.push({ ...win, workspaceId: s.activeWorkspaceId, z: s.nextZ++ });
      });
      get().persist();
    },

    closeWindow: (windowId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (w?.locked) return; // cannot close singletons
        s.windows = s.windows.filter((x) => x.windowId !== windowId);
      });
      get().persist();
    },

    toggleWindowMinimized: (windowId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        w.minimized = !w.minimized;
      });
      get().persist();
    },

    minimizePanelTab: (windowId, tabId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        if (!w.tabs.every((t) => t.view === "experimentPanel")) return;
        const tab = w.tabs.find((t) => t.tabId === tabId);
        if (!tab) return;

        w.tabs = w.tabs.filter((t) => t.tabId !== tabId);
        if (w.activeTabId === tabId) {
          w.activeTabId = w.tabs[0]?.tabId ?? "";
        }

        s.minimizedPanels.push({
          minimizedId: uid("mini"),
          workspaceId: w.workspaceId,
          tab,
          x: w.x + 24,
          y: w.y + 40,
          w: 188,
          h: 132,
          z: s.nextZ++,
          sourceWindowId: windowId,
        });

        if (!w.locked && w.tabs.length === 0) {
          s.windows = s.windows.filter((x) => x.windowId !== windowId);
        }
      });
      get().persist();
    },

    restoreMinimizedPanel: (minimizedId) => {
      set((s) => {
        const idx = s.minimizedPanels.findIndex((x) => x.minimizedId === minimizedId);
        if (idx < 0) return;
        const mini = s.minimizedPanels[idx];

        const target =
          (mini.sourceWindowId
            ? s.windows.find((w) => w.windowId === mini.sourceWindowId && w.tabs.every((t) => t.view === "experimentPanel"))
            : undefined) ??
          s.windows.find((w) => !w.locked && w.tabs.every((t) => t.view === "experimentPanel"));

        if (target) {
          target.tabs.push(mini.tab);
          target.activeTabId = mini.tab.tabId;
          target.z = s.nextZ++;
        } else {
          const frame = createWindowFrame("experimentPanel", 18);
          s.windows.push({
            windowId: uid("win"),
            workspaceId: mini.workspaceId,
            x: frame.x,
            y: frame.y,
            w: frame.w,
            h: frame.h,
            z: s.nextZ++,
            locked: false,
            tabs: [mini.tab],
            activeTabId: mini.tab.tabId,
          });
        }

        s.minimizedPanels.splice(idx, 1);
      });
      get().persist();
    },

    addTabToWindow: (windowId, tab, activate = true) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        if (w.locked) return;
        const isPanelWindow = w.tabs.every((t) => t.view === "experimentPanel");
        if (isPanelWindow && tab.view !== "experimentPanel") return;
        w.tabs.push(tab);
        if (activate) w.activeTabId = tab.tabId;
      });
      get().persist();
    },

    closeTab: (windowId, tabId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;

        // In locked singletons, don't allow deleting the last remaining tab
        if (w.locked && w.tabs.length === 1) return;

        w.tabs = w.tabs.filter((t) => t.tabId !== tabId);

        if (w.activeTabId === tabId) {
          w.activeTabId = w.tabs[0]?.tabId ?? "";
        }

        // If not locked and no tabs remain, close the whole window
        if (!w.locked && w.tabs.length === 0) {
          s.windows = s.windows.filter((x) => x.windowId !== windowId);
        }
      });
      get().persist();
    },

    setActiveTab: (windowId, tabId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        w.activeTabId = tabId;
      });
      get().persist();
    },

    mergeTabIntoWindow: (fromWindowId, tabId, toWindowId) => {
      if (fromWindowId === toWindowId) return;

      set((s) => {
        const from = s.windows.find((x) => x.windowId === fromWindowId);
        const to = s.windows.find((x) => x.windowId === toWindowId);
        if (!from || !to) return;
        if (to.locked) return;

        const tab = from.tabs.find((t) => t.tabId === tabId);
        if (!tab) return;
        const isPanelWindow = to.tabs.every((t) => t.view === "experimentPanel");
        if (isPanelWindow && tab.view !== "experimentPanel") return;

        // remove from source
        from.tabs = from.tabs.filter((t) => t.tabId !== tabId);
        if (from.activeTabId === tabId) from.activeTabId = from.tabs[0]?.tabId ?? "";

        // add to target
        to.tabs.push(tab);
        to.activeTabId = tab.tabId;

        // if source window is empty and not locked, close it
        if (!from.locked && from.tabs.length === 0) {
          s.windows = s.windows.filter((x) => x.windowId !== fromWindowId);
        }
      });

      get().persist();
    },

    openOrFocusSingletonRunsManager: () => {
      const workspaceId = get().activeWorkspaceId;
      const targetWindowId = runsManagerWindowId(workspaceId);
      const existing = get().windows.find((w) => w.windowId === targetWindowId);
      if (existing) {
        set((s) => {
          const idx = s.windows.findIndex((w) => w.windowId === targetWindowId);
          if (idx < 0) return;
          const next = defaultRunsManagerForWorkspace(workspaceId);
          s.windows[idx].tabs = next.tabs;
          s.windows[idx].activeTabId = next.activeTabId;
          s.windows[idx].locked = true;
          s.windows[idx].workspaceId = workspaceId;
        });
        get().bringToFront(targetWindowId);
        return;
      }
      set((s) => {
        s.windows.push(defaultRunsManagerForWorkspace(workspaceId));
        s.nextZ = Math.max(s.nextZ, 2);
      });
      get().persist();
    },

    detachTab: (windowId, tabId) => {
      set((s) => {
        const w = s.windows.find((x) => x.windowId === windowId);
        if (!w) return;
        if (w.locked) return;

        const tab = w.tabs.find((t) => t.tabId === tabId);
        if (!tab) return;

        w.tabs = w.tabs.filter((t) => t.tabId !== tabId);
        if (w.activeTabId === tabId) w.activeTabId = w.tabs[0]?.tabId ?? "";

        const frame = createWindowFrame(tab.view, 24);
        const win: WindowModel = {
          windowId: uid("win"),
          workspaceId: w.workspaceId,
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
          z: s.nextZ++,
          locked: false,
          tabs: [tab],
          activeTabId: tab.tabId,
        };
        s.windows.push(win);
      });
      get().persist();
    },

    openOrFocusSingletonFileExplorer: () => {
      const workspaceId = get().activeWorkspaceId;
      const targetWindowId = fileExplorerWindowId(workspaceId);
      const existing = get().windows.find((w) => w.windowId === targetWindowId);
      if (existing) {
        set((s) => {
          const idx = s.windows.findIndex((w) => w.windowId === targetWindowId);
          if (idx < 0) return;
          const next = defaultFileExplorerForWorkspace(workspaceId);
          s.windows[idx].tabs = next.tabs;
          s.windows[idx].activeTabId = next.activeTabId;
          s.windows[idx].locked = true;
          s.windows[idx].workspaceId = workspaceId;
        });
        get().bringToFront(targetWindowId);
        return;
      }
      set((s) => {
        s.windows.push(defaultFileExplorerForWorkspace(workspaceId));
        s.nextZ = Math.max(s.nextZ, 2);
      });
      get().persist();
    },

    showToast: (title, message) => {
      set((s) => {
        s.toast = { id: uid("toast"), title, message, ts: Date.now() };
      });
      setTimeout(() => get().clearToast(), 3500);
    },

    clearToast: () => set((s) => void (s.toast = null)),

    persist: () => {
      const s = get();
      const payload = {
        windows: s.windows,
        minimizedPanels: s.minimizedPanels,
        nextZ: s.nextZ,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    },

    rehydrate: () => {
      const raw = localStorage.getItem(LS_KEY);

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const windowsRaw = Array.isArray(parsed.windows) ? parsed.windows : [];
          const safeWindows = windowsRaw.map(sanitizeWindow).filter(Boolean) as WindowModel[];
          const minimizedRaw = Array.isArray(parsed.minimizedPanels) ? parsed.minimizedPanels : [];
          const safeMinimized = minimizedRaw.map(sanitizeMinimizedPanel).filter(Boolean) as MinimizedPanelModel[];
          set((s) => {
            s.windows = safeWindows;
            s.minimizedPanels = safeMinimized;
            s.nextZ = toNumber(parsed.nextZ, 2);

            // Ensure singletons exist
            const rm = s.windows.find((w) => w.windowId === runsManagerWindowId(DEFAULT_WORKSPACE_ID));
            if (!rm) s.windows.unshift(defaultRunsManager());
            else {
              rm.tabs = defaultRunsManager().tabs;
              rm.activeTabId = rm.tabs[0].tabId;
              rm.locked = true;
              rm.workspaceId = DEFAULT_WORKSPACE_ID;
            }

            const fe = s.windows.find((w) => w.windowId === fileExplorerWindowId(DEFAULT_WORKSPACE_ID));
            if (!fe) s.windows.push(defaultFileExplorer());
            else {
              fe.tabs = defaultFileExplorer().tabs;
              fe.activeTabId = fe.tabs[0].tabId;
              fe.locked = true;
              fe.workspaceId = DEFAULT_WORKSPACE_ID;
            }

            // normalize nextZ from actual z values
            let maxZ = 1;
            for (const w of s.windows) maxZ = Math.max(maxZ, w.z ?? 1);
            for (const p of s.minimizedPanels) maxZ = Math.max(maxZ, p.z ?? 1);
            s.nextZ = Math.max(maxZ + 1, s.nextZ);
          });
          return;
        } catch {
          // fallthrough to default
        }
      }

      // default layout
      set((s) => {
        s.windows = [defaultRunsManager(), defaultFileExplorer()];
        s.minimizedPanels = [];
        s.nextZ = 3;
      });
    },
  }))
);
