import type { WindowModel } from "../state/store";
import { useAppStore } from "../state/store";

export default function MinimizedWindowItem({ model }: { model: WindowModel }) {
  const toggleWindowMinimized = useAppStore((s) => s.toggleWindowMinimized);
  const bringToFront = useAppStore((s) => s.bringToFront);

  const active = model.tabs.find((t) => t.tabId === model.activeTabId) ?? model.tabs[0];
  const label = model.tabs.every((t) => t.view === "experimentPanel")
    ? `Panels (${model.tabs.length})`
    : active?.title ?? "Window";

  function restore() {
    toggleWindowMinimized(model.windowId);
    bringToFront(model.windowId);
  }

  return (
    <button className="minimized-window-item" onClick={restore} title={`Restore ${label}`}>
      <span className="minimized-window-dot" aria-hidden="true" />
      <span className="minimized-window-label">{label}</span>
    </button>
  );
}
