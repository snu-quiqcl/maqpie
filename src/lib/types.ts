export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "ABORTED";
export type Priority = number;
export type ScheduleType = "NOW" | "TIMED" | "RECURRING";
export type FileType = "script" | "fpga";
export type RecurrenceKind = "interval" | "daily" | "weekly";

export type RecurrenceRule = {
  kind: RecurrenceKind;
  timezone?: string | null;
  interval_min?: number | null;
  start_immediately?: boolean;
  start_at?: string | null;
  time?: string | null;
  every_n_days?: number | null;
  weekdays?: number[];
  every_n_weeks?: number | null;
  start_date?: string | null;
};

export type FileItem = {
  name: string;
  kind: "file" | "dir";
  size: number | null;
  modified_at: string;
};

export type ParamSchema =
  | { type: "float"; default?: number; min?: number; max?: number; unit?: string }
  | { type: "int"; default?: number; min?: number; max?: number; unit?: string }
  | { type: "string"; default?: string }
  | { type: "bool"; default?: boolean };

export type PanelCreateReq = {
  script_path: string;
  name: string;
  class_name?: string;
  description?: string;
  tags?: string[];
};

export type PanelResp = {
  panel_id: string;
  config_id?: string | null;
  config_meta?: { title: string; updated_at: string };
  script_path: string;
  class_name?: string;
  name: string;
  description?: string;
  tags: string[];
  parameters_schema: Record<string, ParamSchema>;
  param_values: Record<string, unknown>;
  panel: {
    fields: Array<{ key: string; control: string; default?: unknown; unit?: string }>;
    schedule_defaults: {
      priority: Priority;
      schedule_type: ScheduleType;
      scheduled_at: string | null;
      interval_min: number | null;
      timezone?: string | null;
      recurrence?: RecurrenceRule | null;
    };
  };
};

export type RunListItem = {
  rid: number;
  name: string;
  script_path: string;
  class_name?: string;
  author: { user_id: number; username: string };
  priority: Priority;
  schedule_type: ScheduleType;
  scheduled_at: string | null;
  interval_min: number | null;
  schedule_id?: string | null;
  schedule_status?: string | null;
  recurrence?: RecurrenceRule | null;
  recurrence_summary?: string | null;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  tags: string[];
  description?: string;
};

export type RunsListResp = { items: RunListItem[]; next_cursor: string | null };

export type RunDetailResp = RunListItem & {
  parameters_schema?: Record<string, ParamSchema>;
  param_values?: Record<string, unknown>;
};

export type DatasetBrief = {
  dataset_id: string;
  name: string;
  dtype: string;
  shape: number[];
  updated_at: string;
};

export type DatasetsListResp = { rid: number; datasets: DatasetBrief[] };

export type DatasetMetaResp = {
  rid: number;
  dataset_id: string;
  name: string;
  dtype: string;
  shape: number[];
  units?: Record<string, string>;
  parameters?: Record<string, unknown>;
  hints?: Record<string, unknown>;
};

export type DatasetDataResp = {
  rid?: number;
  archive_id?: number;
  dataset_id?: string;
  name: string;
  data: unknown;
};

export type LogItem = { seq: number; ts: string; level: string; msg: string };
export type LogsResp = { rid: number; items: LogItem[] };

export type LoginResp = { token: string; username: string; user_id: number };

export type TtlDevicesResp = { devices: string[] };

export type ArchiveItem = {
  archive_id: number;
  title: string;
  rid: number;
  datasets: string[];
  tags: string[];
  note?: string;
  snapshot_mode?: string;
  author: { user_id: number; username: string };
  created_at: string;
};

export type ArchivesListResp = { items: ArchiveItem[]; next_cursor: string | null };

export type ArchiveDetailResp = {
  archive_id: number;
  title: string;
  rid: number;
  datasets: string[];
  tags: string[];
  note?: string;
  snapshot_mode?: string;
  created_at: string;
};

export type PanelConfigListItem = {
  config_id: string;
  title: string;
  script_path: string;
  class_name: string;
  tags: string[];
  updated_at: string;
  updated_by: { user_id: number | null; username: string | null };
};

export type PanelConfigListResp = { items: PanelConfigListItem[]; next_cursor: string | null };

export type PanelConfigCreateResp = {
  config_id: string;
  created_at: string;
};

export type PanelConfigUpdateResp = {
  config_id: string;
  updated_at: string;
  updated_by: { user_id: number | null; username: string | null };
};
