import type { TabModel } from "../state/store";
import RunsManagerView from "../views/RunsManagerView";
import FileExplorerView from "../views/FileExplorerView";
import ExperimentPanelView from "../views/ExperimentPanelView";
import DataViewerView from "../views/DataViewerView";
import ArchivesView from "../views/ArchivesView";
import PanelConfigsView from "../views/PanelConfigsView";
import TTLControlsView from "../views/TTLControlsView";

export default function ViewHost({ tab, compact }: { tab: TabModel; compact?: boolean }) {
  switch (tab.view) {
    case "runsManager":
      return <RunsManagerView />;
    case "fileExplorer":
      return <FileExplorerView defaultPath={tab.props?.defaultPath} />;
    case "experimentPanel":
      return <ExperimentPanelView panelId={tab.props.panelId} compact={compact} />;
    case "dataViewer":
      return <DataViewerView rid={tab.props.rid} datasetName={tab.props.datasetName} archiveId={tab.props.archiveId} />;
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
