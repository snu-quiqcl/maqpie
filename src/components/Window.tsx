import { useEffect, useMemo, useRef, useState } from "react";
import MinimizeIcon from "@mui/icons-material/Minimize";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FilterNoneIcon from "@mui/icons-material/FilterNone";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useAppStore } from "../state/store";
import type { WindowModel } from "../state/store";
import ViewHost from "./ViewHost";

// This component owns freeform dragging/resizing plus the tab-strip chrome for each desktop window.
export default function Window({ model }: { model: WindowModel }) {
  const bringToFront = useAppStore((s) => s.bringToFront);
  const moveResizeWindow = useAppStore((s) => s.moveResizeWindow);
  const closeWindow = useAppStore((s) => s.closeWindow);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const mergeTabIntoWindow = useAppStore((s) => s.mergeTabIntoWindow);
  const detachTab = useAppStore((s) => s.detachTab);
  const toggleWindowMinimized = useAppStore((s) => s.toggleWindowMinimized);

  const active = useMemo(
    () => model.tabs.find((t) => t.tabId === model.activeTabId) ?? model.tabs[0],
    [model]
  );
  const isPanelWindow = model.tabs.every((t) => t.view === "experimentPanel");
  const minWidth = 260;
  const minHeight = 120;

  const dragState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const tabstripRef = useRef<HTMLDivElement | null>(null);
  const [showTabLeft, setShowTabLeft] = useState(false);
  const [showTabRight, setShowTabRight] = useState(false);
  const [tabHoverSide, setTabHoverSide] = useState<"left" | "right" | null>(null);

  const resizeState = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    mode: "width" | "height" | "both";
  } | null>(null);
  const restoreFrameRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Clamp movement/resizing against the desktop rather than the full browser viewport.
  function getBounds() {
    const windowArea = document.querySelector(".windowArea") as HTMLElement | null;
    const desktop = document.querySelector(".desktop") as HTMLElement | null;
    const rect = windowArea?.getBoundingClientRect() ?? desktop?.getBoundingClientRect();
    return {
      width: rect?.width ?? window.innerWidth,
      height: rect?.height ?? window.innerHeight,
    };
  }

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(n, max));
  }

  function startDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    bringToFront(model.windowId);

    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: model.x,
      originY: model.y,
    };

    const { width, height } = getBounds();

    function onMove(ev: PointerEvent) {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const nextX = dragState.current.originX + dx;
      const nextY = dragState.current.originY + dy;
      const maxX = width - model.w;
      const maxY = height - model.h;
      moveResizeWindow(model.windowId, {
        x: clamp(nextX, 0, maxX),
        y: clamp(nextY, 0, maxY),
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

  function startResize(mode: "width" | "height" | "both", e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(model.windowId);

    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: model.w,
      startH: model.h,
      mode,
    };

    const { width, height } = getBounds();
    const maxW = width - model.x;
    const maxH = height - model.y;

    function onMove(ev: MouseEvent) {
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startX;
      const dy = ev.clientY - resizeState.current.startY;
      let nextW = resizeState.current.startW;
      let nextH = resizeState.current.startH;
      if (resizeState.current.mode === "both" || resizeState.current.mode === "width") {
        nextW = resizeState.current.startW + dx;
      }
      if (resizeState.current.mode === "both" || resizeState.current.mode === "height") {
        nextH = resizeState.current.startH + dy;
      }
      nextW = Math.max(minWidth, Math.min(nextW, maxW));
      nextH = Math.max(minHeight, Math.min(nextH, maxH));
      moveResizeWindow(model.windowId, { w: nextW, h: nextH });
    }

    function onUp() {
      resizeState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const bounds = getBounds();
  const isMaximized = model.x === 0 && model.y === 0 && model.w >= bounds.width && model.h >= bounds.height;

  function toggleMaximized() {
    bringToFront(model.windowId);
    if (isMaximized && restoreFrameRef.current) {
      moveResizeWindow(model.windowId, restoreFrameRef.current);
      restoreFrameRef.current = null;
      return;
    }
    restoreFrameRef.current = { x: model.x, y: model.y, w: model.w, h: model.h };
    moveResizeWindow(model.windowId, {
      x: 0,
      y: 0,
      w: bounds.width,
      h: bounds.height,
    });
  }

  function updateTabArrows() {
    const el = tabstripRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setShowTabLeft(el.scrollLeft > 4);
    setShowTabRight(maxScroll - el.scrollLeft > 4);
  }

  function scrollTabs(direction: "left" | "right") {
    const el = tabstripRef.current;
    if (!el) return;
    const delta = Math.max(160, Math.floor(el.clientWidth * 0.45));
    el.scrollBy({ left: direction === "left" ? -delta : delta, behavior: "smooth" });
  }

  function handleTabstripMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = tabstripRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = 42;
    const onLeft = e.clientX - rect.left <= edge;
    const onRight = rect.right - e.clientX <= edge;
    if (onLeft && showTabLeft) setTabHoverSide("left");
    else if (onRight && showTabRight) setTabHoverSide("right");
    else setTabHoverSide(null);
  }

  useEffect(() => {
    updateTabArrows();
    const el = tabstripRef.current;
    if (!el) return;
    const onScroll = () => updateTabArrows();
    el.addEventListener("scroll", onScroll);
    window.addEventListener("resize", updateTabArrows);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateTabArrows);
    };
  }, [model.tabs.length, model.activeTabId, model.w]);

  return (
    <div
      className="window-shell"
      style={{ left: model.x, top: model.y, width: model.w, height: model.h, zIndex: model.z }}
      onMouseDown={() => bringToFront(model.windowId)}
    >
      <div className={`window ${model.locked ? "singleton" : ""}`} style={{ width: "100%", height: "100%" }}>
        <div className="titlebar" onPointerDown={startDrag}>
          <div className="actions trafficLights">
            <button
              className="trafficButton trafficMinimize"
              onClick={() => toggleWindowMinimized(model.windowId)}
              title={isPanelWindow ? "Minimize panels" : "Minimize window"}
              aria-label={isPanelWindow ? "Minimize panels" : "Minimize window"}
            >
              {model.minimized ? <CropSquareIcon fontSize="inherit" /> : <MinimizeIcon fontSize="inherit" />}
            </button>
            <button
              className="trafficButton trafficZoom"
              onClick={toggleMaximized}
              title={isMaximized ? "Restore window" : "Maximize window"}
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
            >
              {isMaximized ? <FilterNoneIcon fontSize="inherit" /> : <CropSquareIcon fontSize="inherit" />}
            </button>
            {!model.locked && (
              <button
                className="trafficButton trafficClose"
                onClick={() => closeWindow(model.windowId)}
                title="Close window"
                aria-label="Close window"
              >
                ✕
              </button>
            )}
          </div>
          <div
            className="title"
            title={isPanelWindow ? `Panels (${model.tabs.length})` : active?.title ?? "Window"}
          >
            {isPanelWindow ? `Panels (${model.tabs.length})` : active?.title ?? "Window"}
          </div>
        </div>

        {!model.minimized || isPanelWindow ? (
          <div className="tabstripWrap" onMouseLeave={() => setTabHoverSide(null)}>
            {showTabLeft ? (
              <button
                className={`tabstripArrow left ${tabHoverSide === "left" ? "visible" : ""}`}
                onClick={() => scrollTabs("left")}
                title="Scroll tabs left"
              >
                <ChevronLeftIcon fontSize="inherit" />
              </button>
            ) : null}
            {showTabRight ? (
              <button
                className={`tabstripArrow right ${tabHoverSide === "right" ? "visible" : ""}`}
                onClick={() => scrollTabs("right")}
                title="Scroll tabs right"
              >
                <ChevronRightIcon fontSize="inherit" />
              </button>
            ) : null}
            <div
              ref={tabstripRef}
              className="tabstrip"
              onMouseMove={handleTabstripMouseMove}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (model.locked) return;
                const raw = e.dataTransfer.getData("application/x-labtab");
                if (!raw) return;
                const { fromWindowId, tabId } = JSON.parse(raw);
                mergeTabIntoWindow(fromWindowId, tabId, model.windowId);
              }}
            >
              {model.tabs.map((t) => {
                const isActive = t.tabId === model.activeTabId;
                return (
                  <div
                    key={t.tabId}
                    className={`tab ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab(model.windowId, t.tabId);
                    }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-labtab",
                        JSON.stringify({ fromWindowId: model.windowId, tabId: t.tabId })
                      );
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const raw = e.dataTransfer.getData("application/x-labtab");
                      if (!raw) return;
                      const { fromWindowId, tabId } = JSON.parse(raw);
                      mergeTabIntoWindow(fromWindowId, tabId, model.windowId);
                      setActiveTab(model.windowId, t.tabId);
                    }}
                  >
                    <span className="tabLabel" title={t.title}>{t.title}</span>
                    <span className="tabActions">
                      {!model.locked && (
                        <button
                          className="tabAction"
                          onClick={(e) => {
                            e.stopPropagation();
                            detachTab(model.windowId, t.tabId);
                          }}
                          title="Detach tab"
                        >
                          ↗
                        </button>
                      )}
                      {(!model.locked || model.tabs.length > 1) && (
                        <button
                          className="tabAction"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(model.windowId, t.tabId);
                          }}
                          title="Close tab"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              <div style={{ flex: 1 }} />
            </div>
          </div>
        ) : null}

        {!model.minimized || isPanelWindow ? (
          <div className="content">
            {isPanelWindow && model.minimized ? (
              <div className="panel-stack">
                {model.tabs.map((t) => (
                  <div key={t.tabId} className="panel-stack-item">
                    <ViewHost tab={t} compact windowId={model.windowId} />
                  </div>
                ))}
              </div>
            ) : (
              active ? <ViewHost tab={active} windowId={model.windowId} /> : <div className="small">No tab</div>
            )}
          </div>
        ) : null}

        {!model.minimized || isPanelWindow ? (
          <>
            <div className="resize-grip-right" onMouseDown={(e) => startResize("width", e)} />
            <div className="resize-grip-bottom" onMouseDown={(e) => startResize("height", e)} />
            <div className="resize-grip-corner" onMouseDown={(e) => startResize("both", e)} />
          </>
        ) : null}
      </div>
    </div>
  );
}
