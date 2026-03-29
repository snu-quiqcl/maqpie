import { useRef } from "react";
import type { MinimizedPanelModel } from "../state/store";
import { useAppStore } from "../state/store";
import ExperimentPanelView from "../views/ExperimentPanelView";

export default function MinimizedPanelCard({ model }: { model: MinimizedPanelModel }) {
  const bringToFront = useAppStore((s) => s.bringMinimizedPanelToFront);
  const moveMinimizedPanel = useAppStore((s) => s.moveMinimizedPanel);
  const restoreMinimizedPanel = useAppStore((s) => s.restoreMinimizedPanel);

  const dragState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(n, max));
  }

  function startDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    bringToFront(model.minimizedId);

    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: model.x,
      originY: model.y,
    };

    function onMove(ev: PointerEvent) {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const maxX = window.innerWidth - model.w - 8;
      const maxY = window.innerHeight - model.h - 8;
      moveMinimizedPanel(model.minimizedId, {
        x: clamp(dragState.current.originX + dx, 8, maxX),
        y: clamp(dragState.current.originY + dy, 50, maxY),
      });
    }

    function onUp() {
      dragState.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const panelId = typeof model.tab.props?.panelId === "string" ? model.tab.props.panelId : "";

  return (
    <div
      className="minimized-panel-shell"
      style={{ left: model.x, top: model.y, width: model.w, height: model.h, zIndex: model.z }}
      onMouseDown={() => bringToFront(model.minimizedId)}
    >
      <div className="minimized-panel-card">
        <div className="minimized-panel-handle" onPointerDown={startDrag}>
          <div className="minimized-panel-title" title={model.tab.title}>
            {model.tab.title}
          </div>
          <button
            className="minimized-panel-return"
            onClick={() => restoreMinimizedPanel(model.minimizedId)}
            title="Return to panel window"
          >
            Return
          </button>
        </div>
        <div className="minimized-panel-body">
          <ExperimentPanelView panelId={panelId} compact minimizedCard onRestore={() => restoreMinimizedPanel(model.minimizedId)} />
        </div>
      </div>
    </div>
  );
}
