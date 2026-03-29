import { useEffect, useState } from "react";
import { createWindowFrame } from "../lib/windowFrame";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Popover,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { api } from "../lib/api";
import type { FileItem, FileType } from "../lib/types";
import { useAppStore } from "../state/store";
import { fileExplorerConfig } from "../config/fileExplorer";
import { panelOpenConfig } from "../config/panels";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

export default function FileExplorerView({ defaultPath }: { defaultPath?: string }) {
  const showToast = useAppStore((s) => s.showToast);
  const windows = useAppStore((s) => s.windows);
  const addWindow = useAppStore((s) => s.addWindow);
  const addTabToWindow = useAppStore((s) => s.addTabToWindow);

  const [type, setType] = useState<FileType>(fileExplorerConfig.defaultType);
  // Use empty string to represent the repository root for the given file type
  // (backend treats missing/empty 'path' as the directory itself, e.g. BASE/user_scripts)
  const normalize = (p?: string) => {
    if (!p) return "";
    // strip leading ../ or ./ and trim slashes
    let next = p.replace(/^\.\.\//, "").replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
    // If a legacy path includes the backend root folder, map it back to the API root.
    if (next.startsWith("quail/user_scripts") || next === "user_scripts") return "";
    if (next.startsWith("user_scripts/")) return next.replace(/^user_scripts\//, "");
    return next;
  };
  const [path, setPath] = useState<string>(normalize(defaultPath));
  const [items, setItems] = useState<FileItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [children, setChildren] = useState<Record<string, FileItem[]>>({});
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [previewAnchor, setPreviewAnchor] = useState<{ x: number; y: number } | null>(null);
  const [previewPath, setPreviewPath] = useState<string>("");
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>("");
  const [panelDialogOpen, setPanelDialogOpen] = useState(false);
  const [pendingScriptPath, setPendingScriptPath] = useState<string>("");
  const [panelName, setPanelName] = useState<string>("");
  const [panelDesc, setPanelDesc] = useState<string>("");
  const [panelTags, setPanelTags] = useState<string>("");
  const [panelClass, setPanelClass] = useState<string>("");
  const [classOptions, setClassOptions] = useState<string[]>([]);
  const [classLoading, setClassLoading] = useState(false);

  const allowedExts = fileExplorerConfig.allowedExtensions ?? [];

  async function refresh(nextPath?: string) {
    setLoading(true);
    try {
      const rp = nextPath ?? path;
      const resp = await api.listFiles(type, rp);
      // backend returns 'path' as rel path (may be empty string for root)
      setPath(resp.path ?? (rp ?? ""));
      const list = resp.items ?? [];
      setItems(list);
      setChildren((prev) => ({ ...prev, [resp.path ?? (rp ?? "")]: list }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Files error", msg);
    } finally {
      setLoading(false);
    }
  }

  async function openPreview(anchor: { x: number; y: number }, filePath: string) {
    setPreviewAnchor(anchor);
    setPreviewPath(filePath);
    setPreviewContent("");
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const resp = await api.readFile(type, filePath);
      setPreviewContent(resp.content ?? "");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewAnchor(null);
    setPreviewPath("");
    setPreviewContent("");
    setPreviewError("");
    setPreviewLoading(false);
  }

  useEffect(() => {
    // On type change, refresh to the provided defaultPath (if any), otherwise to root ('')
    const root = normalize(defaultPath) ?? (type === "script" ? "" : "");
    setExpanded(new Set([root || ""]));
    refresh(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  function fullPath(parent: string, name: string) {
    const clean = name.replace(/\/$/, "");
    return parent ? `${parent.replace(/\/$/, "")}/${clean}` : clean;
  }

  async function toggleDir(parent: string, dirName: string) {
    const p = fullPath(parent, dirName);
    const next = new Set(expanded);
    if (next.has(p)) {
      next.delete(p);
      setExpanded(next);
      return;
    }
    next.add(p);
    setExpanded(next);
    if (!children[p]) {
      await fetchChildren(p);
    }
  }

  async function fetchChildren(p: string) {
    try {
      const resp = await api.listFiles(type, p);
      setChildren((prev) => ({ ...prev, [p]: resp.items ?? [] }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Files error", msg);
    }
  }

  async function refreshRoot() {
    const root = normalize(defaultPath) ?? "";
    await refresh(root);
  }

  async function openExperimentPanel(
    scriptPath: string,
    overrides?: { name?: string; description?: string; className?: string; tags?: string[] }
  ) {
    try {
      // backend panel creation already does inspection per your spec, but we keep the name fallback
      const baseName = scriptPath.split("/").pop()?.replace(/\.[^/.]+$/, "") ?? "Experiment";
      const name = overrides?.name?.trim() || baseName;
      const className = overrides?.className?.trim() || name;
      const description = overrides?.description?.trim() || "";
      const panel = await api.createPanel({
        script_path: scriptPath,
        name,
        class_name: className,
        description,
        tags: overrides?.tags?.length ? overrides.tags : ["from_ui"],
      });

      // open as a new window/tab
      const tab = { tabId: uid("tab"), title: `Panel: ${panel.name}`, view: "experimentPanel" as const, props: { panelId: panel.panel_id } };

      const target = windows.find((w) => !w.locked && w.tabs.every((t) => t.view === "experimentPanel"));
      if (target) addTabToWindow(target.windowId, tab, true);
      else {
        const frame = createWindowFrame("experimentPanel");
        const win = {
          windowId: uid("win"),
          x: frame.x,
          y: frame.y,
          w: frame.w,
          h: frame.h,
          locked: false,
          tabs: [tab],
          activeTabId: tab.tabId,
        };
        addWindow(win);
      }

      showToast("Panel opened", panel.panel_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("Open panel failed", msg);
    }
  }

  async function startPanelDialog(scriptPath: string) {
    const baseName = scriptPath.split("/").pop()?.replace(/\.[^/.]+$/, "") ?? "Experiment";
    setPendingScriptPath(scriptPath);
    setPanelName(baseName);
    setPanelDesc("");
    setPanelTags("");
    setPanelClass(baseName);
    setClassOptions([]);
    if (panelOpenConfig.enableClassSelection) {
      setClassLoading(true);
      try {
        const resp = await api.inspectPanelClasses(scriptPath);
        if (Array.isArray(resp?.classes) && resp.classes.length > 0) {
          setClassOptions(resp.classes);
          setPanelClass(resp.classes[0]);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast("Class inspection failed", msg);
      } finally {
        setClassLoading(false);
      }
    }
    setPanelDialogOpen(true);
  }

  function renderBranch(parent: string, depth: number) {
    const list = children[parent] ?? (parent === path ? items : []);
    return list.map((item) => {
      const isDir = item.kind === "dir";
      if (!isDir && type === "script" && allowedExts.length > 0) {
        const ok = allowedExts.some((ext) => item.name.toLowerCase().endsWith(ext.toLowerCase()));
        if (!ok) return null;
      }
      const name = item.name;
      const full = fullPath(parent, name);
      const isOpen = expanded.has(full);
      return (
        <Box key={`${parent}/${name}`} sx={{ pl: depth * 2 }}>
          <ListItemButton
            dense
            selected={selectedPath === full}
            sx={{
              py: 0.25,
              px: 0.5,
              minHeight: 24,
              borderRadius: 1,
              "&.Mui-selected": {
                backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
              },
              "&:hover": { backgroundColor: "rgba(255,255,255,0.05)" },
            }}
            onClick={() => setSelectedPath(full)}
            onContextMenu={(e) => {
              if (isDir) return;
              e.preventDefault();
              openPreview({ x: e.clientX, y: e.clientY }, full);
            }}
            onDoubleClick={() => {
              if (isDir) {
                toggleDir(parent, name);
              } else {
                const fullFile = full;
                if (type === "script") startPanelDialog(fullFile);
                else alert(`FPGA file selected: ${fullFile}`);
              }
            }}
          >
            <ListItemIcon sx={{ minWidth: 20, color: "text.secondary" }}>
              {isDir ? (
                <IconButton
                  size="small"
                  sx={{ p: 0.2 }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await toggleDir(parent, name);
                  }}
                >
                  {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                </IconButton>
              ) : (
                <span style={{ width: 20 }} />
              )}
            </ListItemIcon>
            <ListItemIcon sx={{ minWidth: 20, color: isDir ? "#6aa6ff" : "text.secondary" }}>
              {isDir ? (isOpen ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />) : <InsertDriveFileIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText
              primary={name}
              primaryTypographyProps={{ variant: "body2", sx: { fontSize: 12, fontWeight: isDir ? 600 : 400 } }}
            />
          </ListItemButton>
          {isDir && isOpen ? renderBranch(full, depth + 1) : null}
        </Box>
      );
    });
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 0,
        overflow: "hidden",
        borderRadius: 1.5,
        borderColor: "var(--border)",
        bgcolor: "var(--panel2)",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={0.75}
        alignItems="center"
        sx={{
          p: 0.75,
          background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {fileExplorerConfig.showTypeToggle ? (
          <Select
            size="small"
            value={type}
            onChange={(e) => setType(e.target.value as FileType)}
            sx={{ "& .MuiSelect-select": { py: "3px", fontSize: 11.5 } }}
          >
            <MenuItem value="script">script</MenuItem>
            <MenuItem value="fpga">fpga</MenuItem>
          </Select>
        ) : null}
        <Button size="small" variant="outlined" disabled={loading} onClick={() => refresh(path)}>
          Refresh
        </Button>
      </Stack>

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ p: 0.75, pt: 0.6 }}>
        <Button size="small" variant="outlined" onClick={refreshRoot} disabled={path === ""}>
          Root
        </Button>
        <Typography
          variant="caption"
          sx={{
            ml: 1,
            px: 0.75,
            py: 0.2,
            fontFamily: "var(--mono)",
            border: "1px solid var(--border)",
            borderRadius: 0.8,
            bgcolor: "rgba(0,0,0,0.16)",
          }}
        >
          {path ? `/${path}` : type === "script" ? "/user_scripts" : "/user_fpga"}
        </Typography>
      </Stack>

      <List
        dense
        sx={{
          mt: 0,
          mx: 0.75,
          mb: 0.75,
          p: 0.5,
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 1.2,
          bgcolor: "rgba(0,0,0,0.18)",
          maxHeight: 340,
          overflow: "auto",
        }}
      >
        {renderBranch(path || "", 0)}
      </List>

      <Typography variant="caption" color="text.secondary" sx={{ px: 0.9, pb: 0.9, display: "block" }}>
        Finder-style tip: double-click a script to create/open a panel.
      </Typography>

      <Dialog
        open={panelDialogOpen}
        onClose={() => setPanelDialogOpen(false)}
        maxWidth="xs"
        fullWidth={false}
        PaperProps={{ sx: { width: "min(460px, calc(100% - 24px))", m: 1.5 } }}
      >
        <DialogTitle sx={{ overflowWrap: "anywhere", pb: 1, borderBottom: "1px solid var(--border)" }}>
          Create panel
        </DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1.5, pt: 1.5, overflowX: "hidden" }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Panel title
            </Typography>
            <TextField
              size="small"
              value={panelName}
              onChange={(e) => setPanelName(e.target.value)}
              placeholder="e.g. example_script"
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Description
            </Typography>
            <TextField
              size="small"
              value={panelDesc}
              onChange={(e) => setPanelDesc(e.target.value)}
              multiline
              minRows={2}
              placeholder="Short summary of what this panel does"
              fullWidth
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Tags (CSV)
            </Typography>
            <TextField
              size="small"
              value={panelTags}
              onChange={(e) => setPanelTags(e.target.value)}
              placeholder="calib, ion, baseline"
              fullWidth
            />
          </Box>
          {panelOpenConfig.enableClassSelection ? (
            classOptions.length ? (
              <Select
                size="small"
                value={panelClass}
                onChange={(e) => setPanelClass(e.target.value)}
                disabled={classLoading}
              >
                {classOptions.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </Select>
            ) : (
              <TextField
                size="small"
                label="Class name"
                value={panelClass}
                onChange={(e) => setPanelClass(e.target.value)}
                disabled={classLoading}
              />
            )
          ) : null}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            Script: {pendingScriptPath || "(none)"}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPanelDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            sx={{ textTransform: "none" }}
            onClick={async () => {
              const scriptPath = pendingScriptPath;
              if (!scriptPath) return;
              const tags = panelTags
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t.length > 0);
              await openExperimentPanel(scriptPath, {
                name: panelName,
                description: panelDesc,
                className: panelClass,
                tags,
              });
              setPanelDialogOpen(false);
            }}
          >
            Create panel
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={Boolean(previewAnchor)}
        onClose={closePreview}
        anchorReference="anchorPosition"
        anchorPosition={
          previewAnchor ? { top: previewAnchor.y, left: previewAnchor.x } : undefined
        }
        PaperProps={{ sx: { width: 720, height: 420, p: 1.5, bgcolor: "var(--panel)" } }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontFamily: "var(--mono)" }}>
            {previewPath || "Preview"}
          </Typography>
          <Button size="small" onClick={closePreview}>Close</Button>
        </Stack>
        {previewLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
            <CircularProgress size={18} />
          </Stack>
        ) : previewError ? (
          <Typography variant="caption" color="error">{previewError}</Typography>
        ) : (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              height: "calc(100% - 36px)",
              overflow: "auto",
              bgcolor: "var(--panel2)",
              border: "1px solid var(--border)",
              borderRadius: 1,
              fontFamily: "var(--mono)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {previewContent || "(empty)"}
          </Box>
        )}
      </Popover>
    </Paper>
  );
}
