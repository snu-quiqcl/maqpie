// src/App.tsx
import { useEffect, useState } from "react";
import { Box, Button, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import type { WindowModel } from "./state/store";
import Window from "./components/Window";
import ViewHost from "./components/ViewHost";
import { api, getApiBase, setToken, setUserId } from "./lib/api";
import { useAppStore } from "./state/store";
import longLogo from "./assets/longlogo.png";
import { workspaceConfig } from "./config/workspace";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

export default function App() {
  const windows = useAppStore((s) => s.windows);
  const rehydrate = useAppStore((s) => s.rehydrate);
  const showToast = useAppStore((s) => s.showToast);
  const toast = useAppStore((s) => s.toast);
  const username = useAppStore((s) => s.username);
  const setUsername = useAppStore((s) => s.setUsername);

  const openOrFocusRM = useAppStore((s) => s.openOrFocusSingletonRunsManager);
  const openOrFocusFE = useAppStore((s) => s.openOrFocusSingletonFileExplorer);
  const addWindow = useAppStore((s) => s.addWindow);
  const addTabToWindow = useAppStore((s) => s.addTabToWindow);

  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("auth_token")));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState(localStorage.getItem("ui_theme") ?? "default");
  const [bgColor, setBgColor] = useState(localStorage.getItem("ui_bg_color") ?? "");
  const [bgImage, setBgImage] = useState(localStorage.getItem("ui_bg_image") ?? "");
  const [connectionInfo, setConnectionInfo] = useState<{ state: "checking" | "connected" | "offline"; detail: string }>({
    state: "checking",
    detail: "Checking backend...",
  });

  const popoutParams = new URLSearchParams(window.location.search);
  const isPopout = popoutParams.get("popout") === "1";
  const popoutTabRaw = popoutParams.get("tab");
  let popoutTab: (WindowModel["tabs"][number] & { originWindowId?: string }) | null = null;
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
    openOrFocusRM();
    openOrFocusFE();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

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
    function popIn(tab: WindowModel["tabs"][number] & { originWindowId?: string }) {
      const state = useAppStore.getState();
      const exists = state.windows.some((w) => w.tabs.some((t) => t.tabId === tab.tabId));
      if (exists) {
        localStorage.removeItem("popin_tab");
        return;
      }
      const targetId = tab.originWindowId;
      if (targetId) {
        const target = state.windows.find((w) => w.windowId === targetId);
        if (target && !target.locked) {
          addTabToWindow(targetId, tab, true);
          localStorage.removeItem("popin_tab");
          return;
        }
      }
      const win: Omit<WindowModel, "z"> = {
        windowId: `win_${Math.random().toString(16).slice(2, 10)}`,
        x: 140,
        y: 120,
        w: 620,
        h: 440,
        locked: false,
        tabs: [tab],
        activeTabId: tab.tabId,
      };
      addWindow(win);
      localStorage.removeItem("popin_tab");
    }

    function onMessage(ev: MessageEvent) {
      if (!ev.data || ev.data.type !== "popin-tab") return;
      const tab = ev.data.tab as WindowModel["tabs"][number] & { originWindowId?: string };
      if (!tab) return;
      popIn(tab);
    }

    function onStorage(ev: StorageEvent) {
      if (ev.key !== "popin_tab" || !ev.newValue) return;
      try {
        const tab = JSON.parse(ev.newValue) as WindowModel["tabs"][number] & { originWindowId?: string };
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
        const tab = JSON.parse(queued) as WindowModel["tabs"][number] & { originWindowId?: string };
        popIn(tab);
      } catch {
        // ignore
      }
    }
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
  }, [addWindow, addTabToWindow]);

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
    showToast("Logged out", "Token cleared");
  }

  function openDataViewer() {
    const tabId = uid("tab");
    const win: Omit<WindowModel, "z"> = {
      windowId: uid("win"),
      x: 220,
      y: 140,
      w: 680,
      h: 480,
      locked: false,
      tabs: [{ tabId, title: "Data Viewer", view: "dataViewer", props: { rid: 0, datasetName: "" } }],
      activeTabId: tabId,
    };
    addWindow(win);
  }

  function openPanelConfigs() {
    const tabId = uid("tab");
    const win: Omit<WindowModel, "z"> = {
      windowId: uid("win"),
      x: 240,
      y: 140,
      w: 700,
      h: 460,
      locked: false,
      tabs: [{ tabId, title: "Panel Configs", view: "panelConfigs", props: {} }],
      activeTabId: tabId,
    };
    addWindow(win);
  }

  function openArchives() {
    const tabId = uid("tab");
    const win: Omit<WindowModel, "z"> = {
      windowId: uid("win"),
      x: 200,
      y: 160,
      w: 680,
      h: 460,
      locked: false,
      tabs: [{ tabId, title: "Archives", view: "archives", props: {} }],
      activeTabId: tabId,
    };
    addWindow(win);
  }

  function openTtlControls() {
    const tabId = uid("tab");
    const win: Omit<WindowModel, "z"> = {
      windowId: uid("win"),
      x: 260,
      y: 140,
      w: 560,
      h: 400,
      locked: false,
      tabs: [{ tabId, title: "TTL Controls", view: "ttlControls", props: {} }],
      activeTabId: tabId,
    };
    addWindow(win);
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
            <img className="loginLogo" src={longLogo} alt="Organization logo" />
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
          <div>IQUIP Web prototype</div>
          <div className="brandSub">
            {workspaceConfig.teamName}
          </div>
        </div>

        <div className="pill">
          <Stack direction="row" spacing={0.5}>
            <Button size="small" variant="outlined" onClick={openDataViewer}>Data Viewer</Button>
            <Button size="small" variant="outlined" onClick={openPanelConfigs}>Panel Configs</Button>
            <Button size="small" variant="outlined" onClick={openOrFocusFE}>File Explorer</Button>
            <Button size="small" variant="outlined" onClick={openArchives}>Archives</Button>
            <Button size="small" variant="outlined" onClick={openTtlControls}>TTL</Button>
          </Stack>
        </div>

        <div className="pill workspacePill">
          <Typography variant="caption" color="text.secondary">Team</Typography>
          <Typography variant="body2">{workspaceConfig.teamName}</Typography>
        </div>

        <div className="topbarRight">
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

      {windows.map((w) => (
        <Window key={w.windowId} model={w} />
      ))}

      {toast && (
        <div className="toast">
          <div className="toastTitle">{toast.title}</div>
        <div className="toastMsg">{toast.message}</div>
      </div>
      )}
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
