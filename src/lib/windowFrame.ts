export type WindowViewKind =
  | "runsManager"
  | "fileExplorer"
  | "experimentPanel"
  | "dataViewer"
  | "archives"
  | "panelConfigs"
  | "ttlControls";

type Frame = { x: number; y: number; w: number; h: number };

const PRESETS: Record<WindowViewKind, Frame> = {
  runsManager: { x: 12, y: 64, w: 760, h: 560 },
  fileExplorer: { x: 760, y: 64, w: 760, h: 560 },
  experimentPanel: { x: 120, y: 104, w: 780, h: 600 },
  dataViewer: { x: 160, y: 96, w: 920, h: 680 },
  archives: { x: 150, y: 96, w: 900, h: 640 },
  panelConfigs: { x: 170, y: 96, w: 880, h: 620 },
  ttlControls: { x: 240, y: 120, w: 680, h: 420 },
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
