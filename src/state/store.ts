// src/state/store.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export type ViewType = "runsManager" | "fileExplorer" | "experimentPanel" | "dataViewer" | "archives" | "panelConfigs" | "ttlControls";

export type TabModel = {
  tabId: string;
  title: string;
  view: ViewType;
  props: Record<string, unknown>;
};

export type WindowModel = {
  windowId: string;
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

export type Toast = { id: string; title: string; message: string; ts: number };

type AppState = {
  apiBase: string;
  username: string | null;

  windows: WindowModel[];
  nextZ: number;

  toast: Toast | null;

  setApiBase: (v: string) => void;
  setUsername: (u: string | null) => void;

  bringToFront: (windowId: string) => void;
  moveResizeWindow: (windowId: string, patch: Partial<Pick<WindowModel, "x" | "y" | "w" | "h">>) => void;

  addWindow: (win: Omit<WindowModel, "z">) => void;
  closeWindow: (windowId: string) => void;
  toggleWindowMinimized: (windowId: string) => void;

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

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
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

/** Singleton: Experiment Manager */
function defaultRunsManager(): WindowModel {
  const tabId = uid("tab");
  return {
    windowId: "win_runs_manager",
    x: 10,
    y: 64,
    w: 720,
    h: 420,
    z: 1,
    locked: true,
    tabs: [{ tabId, title: "Experiment Manager", view: "runsManager", props: {} }],
    activeTabId: tabId,
  };
}

/** Singleton: File Explorer (defaults to your scripts directory) */
function defaultFileExplorer(): WindowModel {
  const tabId = uid("tab");
  return {
    windowId: "win_file_explorer",
    x: 760,
    y: 64,
    w: 560,
    h: 520,
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

    windows: [],
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

    addWindow: (win) => {
      set((s) => {
        s.windows.push({ ...win, z: s.nextZ++ });
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
      const existing = get().windows.find((w) => w.windowId === "win_runs_manager");
      if (existing) {
        set((s) => {
          const idx = s.windows.findIndex((w) => w.windowId === "win_runs_manager");
          if (idx < 0) return;
          const next = defaultRunsManager();
          s.windows[idx].tabs = next.tabs;
          s.windows[idx].activeTabId = next.activeTabId;
          s.windows[idx].locked = true;
        });
        get().bringToFront("win_runs_manager");
        return;
      }
      set((s) => {
        s.windows.push(defaultRunsManager());
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

        const win: WindowModel = {
          windowId: uid("win"),
          x: w.x + 30,
          y: w.y + 30,
          w: Math.max(420, w.w - 40),
          h: Math.max(320, w.h - 40),
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
      const existing = get().windows.find((w) => w.windowId === "win_file_explorer");
      if (existing) {
        set((s) => {
          const idx = s.windows.findIndex((w) => w.windowId === "win_file_explorer");
          if (idx < 0) return;
          const next = defaultFileExplorer();
          s.windows[idx].tabs = next.tabs;
          s.windows[idx].activeTabId = next.activeTabId;
          s.windows[idx].locked = true;
        });
        get().bringToFront("win_file_explorer");
        return;
      }
      set((s) => {
        s.windows.push(defaultFileExplorer());
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
          set((s) => {
            s.windows = safeWindows;
            s.nextZ = toNumber(parsed.nextZ, 2);

            // Ensure singletons exist
            const rm = s.windows.find((w) => w.windowId === "win_runs_manager");
            if (!rm) s.windows.unshift(defaultRunsManager());
            else {
              rm.tabs = defaultRunsManager().tabs;
              rm.activeTabId = rm.tabs[0].tabId;
              rm.locked = true;
            }

            const fe = s.windows.find((w) => w.windowId === "win_file_explorer");
            if (!fe) s.windows.push(defaultFileExplorer());
            else {
              fe.tabs = defaultFileExplorer().tabs;
              fe.activeTabId = fe.tabs[0].tabId;
              fe.locked = true;
            }

            // normalize nextZ from actual z values
            let maxZ = 1;
            for (const w of s.windows) maxZ = Math.max(maxZ, w.z ?? 1);
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
        s.nextZ = 3;
      });
    },
  }))
);
