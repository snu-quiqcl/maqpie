export type WorkspaceId = string;

export type WorkspaceMeta = {
  workspaceId: WorkspaceId;
  name: string;
};

export const DEFAULT_WORKSPACE_ID: WorkspaceId = "workspace_main";
export const DEFAULT_WORKSPACE_NAME = "Main";

export function createWorkspaceMeta(index = 0, name?: string): WorkspaceMeta {
  const fallback = index <= 0 ? DEFAULT_WORKSPACE_NAME : `Workspace ${index + 1}`;
  const trimmed = String(name ?? fallback).trim();
  return {
    workspaceId: `workspace_${Math.random().toString(16).slice(2, 10)}`,
    name: trimmed || fallback,
  };
}

export function sanitizeWorkspaceMeta(value: unknown): WorkspaceMeta | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { workspaceId?: unknown; name?: unknown };
  const workspaceId = String(candidate.workspaceId ?? "").trim();
  if (!workspaceId) return null;
  const name = String(candidate.name ?? DEFAULT_WORKSPACE_NAME).trim() || DEFAULT_WORKSPACE_NAME;
  return { workspaceId, name };
}

export function ensureWorkspaceList(items: WorkspaceMeta[] | null | undefined): WorkspaceMeta[] {
  if (Array.isArray(items) && items.length > 0) return items;
  return [{ workspaceId: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME }];
}
