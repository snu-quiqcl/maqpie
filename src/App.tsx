// src/App.tsx
import { useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, Menu, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import type { WindowModel, WorkspaceLayoutSnapshot as StoreWorkspaceLayoutSnapshot } from "./state/store";
import Window from "./components/Window";
import MinimizedPanelCard from "./components/MinimizedPanelCard";
import MinimizedWindowItem from "./components/MinimizedWindowItem";
import ViewHost from "./components/ViewHost";
import { api, getApiBase, setToken, setUserId } from "./lib/api";
import { createWindowFrame } from "./lib/windowFrame";
import { useAppStore } from "./state/store";
import longLogo from "./assets/longlogo.png";
import maqpieLogo from "./assets/maqpie_text.png";
import { workspaceConfig } from "./config/workspace";
import type { WorkspaceItem } from "./lib/types";

const initialWorkspaceTabs = [
  { workspaceId: "workspace_main", name: "Main" },
];

// Small local ids are enough here because these tabs/windows only live in client state.
function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

type PopoutTabPayload = WindowModel["tabs"][number] & {
  originWindowId?: string;
  originWindow?: Pick<WindowModel, "windowId" | "x" | "y" | "w" | "h" | "locked">;
};

export default function App() {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const windows = useAppStore((s) => s.windows);
  const minimizedPanels = useAppStore((s) => s.minimizedPanels);
  const rehydrate = useAppStore((s) => s.rehydrate);
  const showToast = useAppStore((s) => s.showToast);
  const toast = useAppStore((s) => s.toast);
  const username = useAppStore((s) => s.username);
  const setUsername = useAppStore((s) => s.setUsername);

  const openOrFocusRM = useAppStore((s) => s.openOrFocusSingletonRunsManager);
  const openOrFocusFE = useAppStore((s) => s.openOrFocusSingletonFileExplorer);
  const addWindow = useAppStore((s) => s.addWindow);
  const addTabToWindow = useAppStore((s) => s.addTabToWindow);
  const moveResizeWindow = useAppStore((s) => s.moveResizeWindow);
  const toggleWindowMinimized = useAppStore((s) => s.toggleWindowMinimized);
  const bringToFront = useAppStore((s) => s.bringToFront);
  const exportWorkspaceSnapshot = useAppStore((s) => s.exportWorkspaceSnapshot);
  const importWorkspaceSnapshot = useAppStore((s) => s.importWorkspaceSnapshot);
  const removeWorkspaceState = useAppStore((s) => s.removeWorkspaceState);
  const nextZ = useAppStore((s) => s.nextZ);

  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("auth_token")));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState(localStorage.getItem("ui_theme") ?? "default");
  const [bgColor, setBgColor] = useState(localStorage.getItem("ui_bg_color") ?? "");
  const [bgImage, setBgImage] = useState(localStorage.getItem("ui_bg_image") ?? "");
  const [workspaceTabs, setWorkspaceTabs] = useState(initialWorkspaceTabs);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(initialWorkspaceTabs[0].workspaceId);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ workspaceId: string; anchorEl: HTMLElement | null }>({
    workspaceId: "",
    anchorEl: null,
  });
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState("");
  const [connectionInfo, setConnectionInfo] = useState<{ state: "checking" | "connected" | "offline"; detail: string }>({
    state: "checking",
    detail: "Checking backend...",
  });
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const workspaceLoadRef = useRef(0);
  const suppressAutosaveRef = useRef(false);
  const hydratedFromServerRef = useRef(false);

  useEffect(() => {
    setActiveWorkspaceId(activeWorkspaceTabId);
  }, [activeWorkspaceTabId, setActiveWorkspaceId]);

  const popoutParams = new URLSearchParams(window.location.search);
  const isPopout = popoutParams.get("popout") === "1";
  const popoutTabRaw = popoutParams.get("tab");
  let popoutTab: PopoutTabPayload | null = null;
  if (popoutTabRaw) {
    try {
      popoutTab = JSON.parse(decodeURIComponent(popoutTabRaw));
    } catch {
      popoutTab = null;
    }
  }

  useEffect(() => {
    if (!authed) return;
    rehydrate();
    hydratedFromServerRef.current = false;
    setWorkspaceReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;

    async function bootstrapWorkspaces() {
      try {
        const resp = await api.listWorkspaces();
        if (cancelled) return;
        const tabs = resp.items.length > 0
          ? resp.items.map((item: WorkspaceItem) => ({ workspaceId: item.workspace_id, name: item.name }))
          : initialWorkspaceTabs;
        const activeId = tabs.some((item) => item.workspaceId === resp.active_workspace_id)
          ? resp.active_workspace_id
          : tabs[0].workspaceId;
        setWorkspaceTabs(tabs);
        setActiveWorkspaceTabId(activeId);
        setWorkspaceReady(true);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        showToast("Workspace sync failed", msg);
        setWorkspaceTabs(initialWorkspaceTabs);
        setActiveWorkspaceTabId(initialWorkspaceTabs[0].workspaceId);
        setWorkspaceReady(true);
      }
    }

    bootstrapWorkspaces();
    return () => {
      cancelled = true;
    };
  }, [authed, showToast]);

  useEffect(() => {
    if (!authed || !workspaceReady || !activeWorkspaceTabId) return;
    const requestId = ++workspaceLoadRef.current;
    let cancelled = false;

    async function loadWorkspaceLayout() {
      suppressAutosaveRef.current = true;
      try {
        const resp = await api.getWorkspaceLayout(activeWorkspaceTabId);
        if (cancelled || requestId !== workspaceLoadRef.current) return;
        importWorkspaceSnapshot(
          activeWorkspaceTabId,
          (resp.layout_snapshot ?? { windows: [], minimizedPanels: [], nextZ: 2 }) as Partial<StoreWorkspaceLayoutSnapshot>
        );
        hydratedFromServerRef.current = true;
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          showToast("Workspace load failed", msg);
          openOrFocusRM();
          openOrFocusFE();
        }
      } finally {
        window.setTimeout(() => {
          if (!cancelled && requestId === workspaceLoadRef.current) {
            suppressAutosaveRef.current = false;
          }
        }, 0);
      }
    }

    loadWorkspaceLayout();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceTabId, authed, importWorkspaceSnapshot, openOrFocusFE, openOrFocusRM, showToast, workspaceReady]);

  useEffect(() => {
    if (!authed || !workspaceReady || !hydratedFromServerRef.current || suppressAutosaveRef.current) return;
    const timer = window.setTimeout(() => {
      if (suppressAutosaveRef.current) return;
      const snapshot = exportWorkspaceSnapshot(activeWorkspaceTabId);
      void api.saveWorkspaceLayout(activeWorkspaceTabId, snapshot);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    activeWorkspaceTabId,
    authed,
    exportWorkspaceSnapshot,
    nextZ,
    minimizedPanels,
    windows,
    workspaceReady,
  ]);

  useEffect(() => {
    if (!themeId || themeId === "default") document.body.removeAttribute("data-theme");
    else document.body.setAttribute("data-theme", themeId);
    localStorage.setItem("ui_theme", themeId);
    if (!bgImage) {
      document.body.style.backgroundImage = "";
      if (!bgColor) {
        document.body.style.backgroundColor = "var(--bg)";
      }
    }
  }, [themeId, bgColor, bgImage]);

  useEffect(() => {
    if (bgColor) {
      document.body.style.backgroundColor = bgColor;
      localStorage.setItem("ui_bg_color", bgColor);
    } else {
      document.body.style.backgroundColor = "";
      localStorage.removeItem("ui_bg_color");
    }
  }, [bgColor]);

  useEffect(() => {
    if (bgImage) {
      document.body.style.backgroundImage = `url(${bgImage})`;
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center";
      document.body.style.backgroundRepeat = "no-repeat";
      localStorage.setItem("ui_bg_image", bgImage);
    } else {
      document.body.style.backgroundImage = "";
      localStorage.removeItem("ui_bg_image");
    }
  }, [bgImage]);

  useEffect(() => {
    if (authed) return;
    let cancelled = false;

    async function probeBackend() {
      const base = getApiBase();
      const start = performance.now();
      try {
        const resp = await fetch(`${base}/login/`, { method: "OPTIONS" });
        if (cancelled) return;
        const ms = Math.round(performance.now() - start);
        setConnectionInfo({
          state: "connected",
          detail: `Connected (HTTP ${resp.status}) · ${ms} ms`,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Network error";
        setConnectionInfo({ state: "offline", detail: `Cannot reach backend · ${msg}` });
      }
    }

    probeBackend();
    const timer = window.setInterval(probeBackend, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authed]);

  useEffect(() => {
    function popIn(tab: PopoutTabPayload) {
      const state = useAppStore.getState();
      const exists = state.windows.some((w) => w.tabs.some((t) => t.tabId === tab.tabId));
      if (exists) {
        localStorage.removeItem("popin_tab");
        return;
      }
      const { originWindowId, originWindow, ...restTab } = tab;
      const restoredTab = restTab as WindowModel["tabs"][number];
      const targetId = tab.originWindowId;
      if (targetId) {
        const target = state.windows.find((w) => w.windowId === targetId);
        if (target && !target.locked) {
          addTabToWindow(targetId, restoredTab, true);
          if (target.minimized) toggleWindowMinimized(targetId);
          if (originWindow) {
            moveResizeWindow(targetId, {
              x: originWindow.x,
              y: originWindow.y,
              w: originWindow.w,
              h: originWindow.h,
            });
          }
          bringToFront(targetId);
          localStorage.removeItem("popin_tab");
          return;
        }
      }
      const frame = originWindow ?? createWindowFrame(restoredTab.view);
      const win: Omit<WindowModel, "z" | "workspaceId"> = {
        windowId: originWindow?.windowId ?? `win_${Math.random().toString(16).slice(2, 10)}`,
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        locked: false,
        tabs: [restoredTab],
        activeTabId: restoredTab.tabId,
      };
      addWindow(win);
      localStorage.removeItem("popin_tab");
    }

    function onMessage(ev: MessageEvent) {
      if (!ev.data || ev.data.type !== "popin-tab") return;
      const tab = ev.data.tab as PopoutTabPayload;
      if (!tab) return;
      popIn(tab);
    }

    function onStorage(ev: StorageEvent) {
      if (ev.key !== "popin_tab" || !ev.newValue) return;
      try {
        const tab = JSON.parse(ev.newValue) as PopoutTabPayload;
        popIn(tab);
      } catch {
        // ignore
      }
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    const queued = localStorage.getItem("popin_tab");
    if (queued) {
      try {
        const tab = JSON.parse(queued) as PopoutTabPayload;
        popIn(tab);
      } catch {
        // ignore
      }
    }
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, [addTabToWindow, addWindow, bringToFront, moveResizeWindow, toggleWindowMinimized]);

  async function doLogin() {
    setLoading(true);
      try {
        const resp = await api.login(u, p);
        setToken(resp.token);
        setUserId(resp.user_id);
        localStorage.setItem("username", resp.username);
        setUsername(resp.username);
        setAuthed(true);
        showToast("Logged in", `Hello, ${resp.username}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast("Login failed", msg);
    } finally {
      setLoading(false);
    }
  }

  async function doLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setToken(null);
    setUserId(null);
    setUsername(null);
    setAuthed(false);
    setWorkspaceReady(false);
    hydratedFromServerRef.current = false;
    showToast("Logged out", "Token cleared");
  }

  async function persistWorkspaceNow(workspaceId: string) {
    if (!authed || !workspaceReady || !hydratedFromServerRef.current) return;
    try {
      const snapshot = exportWorkspaceSnapshot(workspaceId);
      await api.saveWorkspaceLayout(workspaceId, snapshot);
    } catch {
      // autosave path already surfaces the general failure mode
    }
  }

  async function selectWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === activeWorkspaceTabId) return;
    await persistWorkspaceNow(activeWorkspaceTabId);
    try {
      await api.activateWorkspace(workspaceId);
    } catch {
      // last write wins: local intent still becomes active in this client
    }
    setActiveWorkspaceTabId(workspaceId);
  }

  function openPanelConfigs() {
    const tabId = uid("tab");
    const frame = createWindowFrame("panelConfigs");
    const win: Omit<WindowModel, "z" | "workspaceId"> = {
      windowId: uid("win"),
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      locked: false,
      tabs: [{ tabId, title: "Panel Configs", view: "panelConfigs", props: {} }],
      activeTabId: tabId,
    };
    addWindow(win);
  }

  function openArchives() {
    const tabId = uid("tab");
    const frame = createWindowFrame("archives");
    const win: Omit<WindowModel, "z" | "workspaceId"> = {
      windowId: uid("win"),
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      locked: false,
      tabs: [{ tabId, title: "Archives", view: "archives", props: {} }],
      activeTabId: tabId,
    };
    addWindow(win);
  }

  function openTtlControls() {
    const tabId = uid("tab");
    const frame = createWindowFrame("ttlControls");
    const win: Omit<WindowModel, "z" | "workspaceId"> = {
      windowId: uid("win"),
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      locked: false,
      tabs: [{ tabId, title: "TTL Controls", view: "ttlControls", props: {} }],
      activeTabId: tabId,
    };
    addWindow(win);
  }

  async function addWorkspacePreviewTab() {
    try {
      await persistWorkspaceNow(activeWorkspaceTabId);
      const created = await api.createWorkspace({ name: `Workspace ${workspaceTabs.length + 1}` });
      setWorkspaceTabs((prev) => [...prev, { workspaceId: created.workspace_id, name: created.name }]);
      setActiveWorkspaceTabId(created.workspace_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Workspace create failed", msg);
    }
  }

  function openWorkspaceMenu(workspaceId: string, anchorEl: HTMLElement) {
    setWorkspaceMenu({ workspaceId, anchorEl });
  }

  function closeWorkspaceMenu() {
    setWorkspaceMenu({ workspaceId: "", anchorEl: null });
  }

  function startWorkspaceRename(workspaceId: string) {
    if (workspaceId === "workspace_main") {
      closeWorkspaceMenu();
      return;
    }
    const target = workspaceTabs.find((workspace) => workspace.workspaceId === workspaceId);
    if (!target) return;
    setEditingWorkspaceId(workspaceId);
    setEditingWorkspaceName(target.name);
    closeWorkspaceMenu();
  }

  async function commitWorkspaceRename() {
    if (!editingWorkspaceId) return;
    const trimmed = editingWorkspaceName.trim();
    if (trimmed) {
      try {
        await api.updateWorkspace(editingWorkspaceId, { name: trimmed });
        setWorkspaceTabs((prev) =>
          prev.map((workspace) =>
            workspace.workspaceId === editingWorkspaceId ? { ...workspace, name: trimmed } : workspace
          )
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast("Workspace rename failed", msg);
      }
    }
    setEditingWorkspaceId(null);
    setEditingWorkspaceName("");
  }

  function cancelWorkspaceRename() {
    setEditingWorkspaceId(null);
    setEditingWorkspaceName("");
  }

  async function removeWorkspacePreviewTab(workspaceId: string) {
    if (workspaceId === "workspace_main") {
      closeWorkspaceMenu();
      return;
    }
    const target = workspaceTabs.find((workspace) => workspace.workspaceId === workspaceId);
    const ok = window.confirm(`Delete workspace "${target?.name ?? workspaceId}"?`);
    if (!ok) {
      closeWorkspaceMenu();
      return;
    }
    try {
      if (activeWorkspaceTabId === workspaceId) {
        const fallbackId = workspaceTabs.find((workspace) => workspace.workspaceId !== workspaceId)?.workspaceId ?? initialWorkspaceTabs[0].workspaceId;
        await persistWorkspaceNow(activeWorkspaceTabId);
        try {
          await api.activateWorkspace(fallbackId);
        } catch {
          // ignore activation race here
        }
        setActiveWorkspaceTabId(fallbackId);
      }
      await api.deleteWorkspace(workspaceId);
      removeWorkspaceState(workspaceId);
      setWorkspaceTabs((prev) => prev.filter((workspace) => workspace.workspaceId !== workspaceId));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Workspace delete failed", msg);
    }
    closeWorkspaceMenu();
  }

  if (isPopout) {
    if (!popoutTab) {
      return (
        <div className="desktop">
          <Paper variant="outlined" sx={{ p: 2, maxWidth: 520, margin: "20vh auto" }}>
            <Typography variant="h6">Popout unavailable</Typography>
            <Typography variant="body2" color="text.secondary">
              This tab doesn’t have a valid view payload.
            </Typography>
          </Paper>
        </div>
      );
    }

    return (
      <div className="desktop">
        <Box sx={{ position: "fixed", top: 12, right: 12, zIndex: 9000 }}>
          <Button
            size="small"
            variant="outlined"
            sx={{
              minHeight: 26,
              px: 1,
              py: 0.25,
              fontSize: 11,
              lineHeight: 1.1,
              textTransform: "none",
              borderRadius: "999px",
            }}
            onClick={() => {
              localStorage.setItem("popin_tab", JSON.stringify(popoutTab));
              if (window.opener) {
                window.opener.postMessage({ type: "popin-tab", tab: popoutTab }, "*");
                window.close();
              } else {
                window.location.href = window.location.origin + window.location.pathname;
              }
            }}
          >
            Return to main
          </Button>
        </Box>
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{popoutTab.title}</Typography>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <ViewHost tab={popoutTab} />
          </Paper>
        </Box>
      </div>
    );
  }

  return (
    <div className="desktop">
      {!authed ? (
        <div className="loginScreen">
          <div className="loginBackdrop" />
          <img className="loginQuiqclCorner" src={longLogo} alt="QUIQCL logo" />
          <Paper
            variant="outlined"
            sx={{
              position: "fixed",
              top: 14,
              right: 14,
              zIndex: 3,
              p: 1,
              minWidth: 280,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Team: {workspaceConfig.teamName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontFamily: "var(--mono)" }}>
              Backend: {getApiBase()}
            </Typography>
            <Typography
              variant="caption"
              sx={{ display: "block", color: connectionInfo.state === "connected" ? "success.main" : connectionInfo.state === "offline" ? "error.main" : "text.secondary" }}
            >
              {connectionInfo.detail}
            </Typography>
          </Paper>
          <div className="loginCard">
            <div className="loginHero">
              <img className="loginLogo loginLogoMaqpie" src={maqpieLogo} alt="MAQPIE logo" />
            </div>
            <Typography className="loginTitle">Sign in</Typography>
            <Stack className="loginForm" spacing={1.25}>
              <TextField
                size="small"
                label="Username"
                value={u}
                onChange={(e) => setU(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) doLogin();
                }}
              />
              <TextField
                size="small"
                label="Password"
                type="password"
                value={p}
                onChange={(e) => setP(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) doLogin();
                }}
              />
              <Button variant="contained" disabled={loading} onClick={doLogin}>
                {loading ? "Signing in..." : "Login"}
              </Button>
              <Typography variant="caption" color="text.secondary">Cannot log in?</Typography>
              <Button
                size="small"
                variant="outlined"
                component="a"
                href={`mailto:${workspaceConfig.adminEmail}`}
              >
                Contact administrator
              </Button>
            </Stack>
          </div>
        </div>
      ) : (
      <>
      <div className="topbar">
        <div className="brand">
          <div>MAQPIE</div>
        </div>

        <div className="launcherRow">
          <Stack direction="row" spacing={0.5}>
            <Button size="small" variant="outlined" className="launcherButton launcherButtonAccent" onClick={openPanelConfigs}>Panel Configs</Button>
            <Button size="small" variant="outlined" className="launcherButton launcherButtonAccent" onClick={openArchives}>Archives</Button>
            <Button size="small" variant="outlined" className="launcherButton launcherButtonAccent" onClick={openTtlControls}>TTL</Button>
          </Stack>
        </div>

        <div className="topbarRight">
          <Box className="pill workspacePill" sx={{ mr: 0.75 }}>
            <Typography variant="body2">{workspaceConfig.teamName}</Typography>
          </Box>
          <Box className="pill" sx={{ gap: 1 }}>
            <Typography variant="caption" color="text.secondary">User</Typography>
            <Typography variant="body2">{username ?? localStorage.getItem("username") ?? "?"}</Typography>
            <Button size="small" variant="outlined" onClick={doLogout}>Logout</Button>
            <IconButton size="small" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Box>
        </div>
      </div>


      {windows.filter((w) => w.workspaceId === activeWorkspaceId && !w.minimized).map((w) => (
        <Window key={w.windowId} model={w} />
      ))}

      {windows.some((w) => w.workspaceId === activeWorkspaceId && w.minimized) && (
        <div className="minimized-window-dock">
          {windows.filter((w) => w.workspaceId === activeWorkspaceId && w.minimized).map((w) => (
            <MinimizedWindowItem key={w.windowId} model={w} />
          ))}
        </div>
      )}

      {minimizedPanels.filter((p) => p.workspaceId === activeWorkspaceId).map((p) => (
        <MinimizedPanelCard key={p.minimizedId} model={p} />
      ))}

      {toast && (
        <div className="toast">
          <div className="toastTitle">{toast.title}</div>
        <div className="toastMsg">{toast.message}</div>
      </div>
      )}

      <div className="workspaceStrip workspaceStripPreview">
        <div className="workspaceTabs">
          {workspaceTabs.map((workspace) => (
            <div
              key={workspace.workspaceId}
              className={`workspaceTab ${workspace.workspaceId === activeWorkspaceTabId ? "active" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                openWorkspaceMenu(workspace.workspaceId, e.currentTarget);
              }}
            >
              {editingWorkspaceId === workspace.workspaceId ? (
                <input
                  className="workspaceTabInput"
                  value={editingWorkspaceName}
                  autoFocus
                  onChange={(e) => setEditingWorkspaceName(e.target.value)}
                  onBlur={commitWorkspaceRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitWorkspaceRename();
                    if (e.key === "Escape") cancelWorkspaceRename();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="workspaceTabLabel"
                  onClick={() => {
                    void selectWorkspace(workspace.workspaceId);
                  }}
                >
                  {workspace.name}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="workspaceAdd" onClick={addWorkspacePreviewTab}>
            +
          </button>
        </div>
      </div>
      <Menu
        anchorEl={workspaceMenu.anchorEl}
        open={Boolean(workspaceMenu.anchorEl)}
        onClose={closeWorkspaceMenu}
      >
        <MenuItem
          onClick={() => startWorkspaceRename(workspaceMenu.workspaceId)}
          disabled={workspaceMenu.workspaceId === "workspace_main"}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => removeWorkspacePreviewTab(workspaceMenu.workspaceId)}
          disabled={workspaceMenu.workspaceId === "workspace_main"}
          sx={{ color: "error.main" }}
        >
          Delete
        </MenuItem>
      </Menu>
      </>
      )}
      {authed && settingsOpen && (
        <div className="settingsScreen">
          <Paper variant="outlined" className="settingsPanel">
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Settings</Typography>
              <Button size="small" variant="outlined" onClick={() => setSettingsOpen(false)}>
                Close
              </Button>
            </Stack>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>Theme</Typography>
            <Typography variant="caption" color="text.secondary">
              Pick a mood for the console UI.
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
              {[
                { id: "default", label: "Default" },
                { id: "arctic", label: "Arctic" },
                { id: "ember", label: "Ember" },
                { id: "fern", label: "Fern" },
                { id: "violet", label: "Violet" },
                { id: "paper", label: "Paper" },
                { id: "sunrise", label: "Sunrise" },
                { id: "mint", label: "Mint" },
              ].map((t) => (
                <Button
                  key={t.id}
                  size="small"
                  variant={themeId === t.id ? "contained" : "outlined"}
                  onClick={() => setThemeId(t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </Stack>

            <Typography variant="subtitle2" sx={{ mt: 3 }}>Background</Typography>
            <Typography variant="caption" color="text.secondary">
              Set a solid color or upload an image.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, alignItems: "center" }}>
              <TextField
                size="small"
                label="Background color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                placeholder="#0e1116"
              />
              <Button
                size="small"
                variant="outlined"
                component="label"
              >
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result as string;
                      setBgImage(result);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </Button>
              {bgImage ? (
                <Button size="small" variant="outlined" onClick={() => setBgImage("")}>
                  Clear image
                </Button>
              ) : null}
            </Stack>

            <Typography variant="subtitle2" sx={{ mt: 3 }}>Workspace identity</Typography>
            <Typography variant="caption" color="text.secondary">
              Team/admin contact are file-based in `src/config/workspace.ts`.
            </Typography>
          </Paper>
        </div>
      )}
    </div>
  );
}
