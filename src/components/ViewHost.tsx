import type { TabModel } from "../state/store";
import RunsManagerView from "../views/RunsManagerView";
import FileExplorerView from "../views/FileExplorerView";
import ExperimentPanelView from "../views/ExperimentPanelView";
import DataViewerView from "../views/DataViewerView";
import ArchivesView from "../views/ArchivesView";
import PanelConfigsView from "../views/PanelConfigsView";
import TTLControlsView from "../views/TTLControlsView";

export default function ViewHost({ tab, compact }: { tab: TabModel; compact?: boolean }) {
  const props = tab.props && typeof tab.props === "object" ? tab.props : {};
  const defaultPath = typeof props.defaultPath === "string" ? props.defaultPath : undefined;
  const panelId = typeof props.panelId === "string" ? props.panelId : "";
  const rid = typeof props.rid === "number" ? props.rid : 0;
  const datasetName = typeof props.datasetName === "string" ? props.datasetName : undefined;
  const archiveId = typeof props.archiveId === "number" ? props.archiveId : undefined;

  switch (tab.view) {
    case "runsManager":
      return <RunsManagerView />;
    case "fileExplorer":
      return <FileExplorerView defaultPath={defaultPath} />;
    case "experimentPanel":
      return <ExperimentPanelView panelId={panelId} compact={compact} />;
    case "dataViewer":
      return <DataViewerView rid={rid} datasetName={datasetName} archiveId={archiveId} />;
    case "archives":
      return <ArchivesView />;
    case "panelConfigs":
      return <PanelConfigsView />;
    case "ttlControls":
      return <TTLControlsView />;
    default:
      return <div className="small">Unknown view</div>;
  }
}
