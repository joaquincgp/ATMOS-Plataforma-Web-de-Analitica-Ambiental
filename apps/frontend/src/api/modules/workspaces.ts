import { apiRequest } from '@/api/http-client';

export interface WorkspaceCreateRequest {
  name: string;
  description?: string;
}

export interface WorkspaceResponse {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  schema_name: string;
  storage_path: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DashboardSaveRequest {
  dashboard_id?: string;
  name: string;
  description?: string;
  blocks: Record<string, unknown>[];
  filters: Record<string, unknown>;
}

export interface DashboardResponse {
  id: string;
  name: string;
  description: string | null;
  blocks: Record<string, unknown>[];
  filters: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function listWorkspaces(): Promise<WorkspaceResponse[]> {
  return apiRequest<WorkspaceResponse[]>('/api/v1/workspaces/');
}

export function createWorkspace(payload: WorkspaceCreateRequest): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>('/api/v1/workspaces/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listWorkspaceDashboards(workspaceId: string, limit = 100): Promise<DashboardResponse[]> {
  return apiRequest<DashboardResponse[]>(`/api/v1/workspaces/${workspaceId}/dashboards`, {
    params: { limit },
  });
}

export function saveWorkspaceDashboard(
  workspaceId: string,
  payload: DashboardSaveRequest,
): Promise<DashboardResponse> {
  return apiRequest<DashboardResponse>(`/api/v1/workspaces/${workspaceId}/dashboards`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
