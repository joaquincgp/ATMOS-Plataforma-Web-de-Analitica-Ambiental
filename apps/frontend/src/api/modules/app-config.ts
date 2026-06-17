import { apiRequest } from '@/api/http-client';

export type AppConfigGroup = 'analytics' | 'workspace';

export interface AppConfigItem {
  key: string;
  value: number;
  default_value: number;
  description: string;
  group: AppConfigGroup;
}

export interface AppConfigResponse {
  items: AppConfigItem[];
}

export interface AppConfigUpdateRequest {
  items: Array<{
    key: string;
    value: number;
  }>;
}

export function getAppConfig(): Promise<AppConfigResponse> {
  return apiRequest<AppConfigResponse>('/api/v1/config');
}

export function updateAppConfig(payload: AppConfigUpdateRequest): Promise<AppConfigResponse> {
  return apiRequest<AppConfigResponse>('/api/v1/config', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function resetAppConfig(): Promise<AppConfigResponse> {
  return apiRequest<AppConfigResponse>('/api/v1/config/reset', {
    method: 'POST',
  });
}
