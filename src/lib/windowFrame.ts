export type WindowViewKind =
  | "runsManager"
  | "fileExplorer"
  | "experimentPanel"
  | "dataViewer"
  | "archives"
  | "panelConfigs"
  | "ttlControls";

type Frame = { x: number; y: number; w: number; h: number };

// Presets are intentionally conservative so first-open windows fit comfortably on smaller displays.
const PRESETS: Record<WindowViewKind, Frame> = {
  runsManager: { x: 24, y: 72, w: 560, h: 400 },
  fileExplorer: { x: 620, y: 72, w: 560, h: 400 },
  experimentPanel: { x: 124, y: 102, w: 560, h: 430 },
  dataViewer: { x: 156, y: 96, w: 640, h: 460 },
  archives: { x: 156, y: 96, w: 620, h: 440 },
  panelConfigs: { x: 170, y: 96, w: 600, h: 430 },
  ttlControls: { x: 246, y: 120, w: 500, h: 300 },
};

export function createWindowFrame(view: WindowViewKind, offset = 0): Frame {
  const base = PRESETS[view];
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1440;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 900;
  const margin = 18;
  const topInset = 56;

  const w = Math.min(base.w, Math.max(360, viewportW - margin * 2));
  const h = Math.min(base.h, Math.max(240, viewportH - topInset - margin));
  const maxX = Math.max(margin, viewportW - w - margin);
  const maxY = Math.max(topInset, viewportH - h - margin);
  const x = Math.min(Math.max(base.x + offset, margin), maxX);
  const y = Math.min(Math.max(base.y + offset, topInset), maxY);

  return { x, y, w, h };
}
