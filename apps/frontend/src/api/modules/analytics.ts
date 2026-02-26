import { apiRequest } from '@/api/http-client';

export interface AnalyticsSourceOption {
  id: number;
  name: string;
  source_type: string;
  etl_run_id: string;
  downloaded_at: string | null;
  row_count: number;
}

export interface AnalyticsStationOption {
  code: string;
  name: string;
}

export interface AnalyticsVariableOption {
  code: string;
  name: string;
}

export interface AnalyticsFilterOptionsResponse {
  sources: AnalyticsSourceOption[];
  stations: AnalyticsStationOption[];
  variables: AnalyticsVariableOption[];
  min_observed_at: string | null;
  max_observed_at: string | null;
}

export interface AnalyticsQueryRequest {
  source_file_ids?: number[];
  station_codes?: string[];
  variable_codes?: string[];
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface AnalyticsDataRow {
  observed_at: string;
  station_code: string;
  station_name: string;
  variable_code: string;
  variable_name: string;
  value: number;
  unit: string | null;
  source_file_id: number;
  source_file_name: string;
  source_type: string;
}

export interface AnalyticsQueryResponse {
  rows: AnalyticsDataRow[];
  row_count: number;
  truncated: boolean;
}

export interface SqlPreviewRequest {
  sql: string;
  limit?: number;
}

export interface SqlPreviewResponse {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  row_count: number;
  truncated: boolean;
}

export function getAnalyticsFilters(): Promise<AnalyticsFilterOptionsResponse> {
  return apiRequest<AnalyticsFilterOptionsResponse>('/api/v1/analytics/filters');
}

export function runAnalyticsQuery(payload: AnalyticsQueryRequest): Promise<AnalyticsQueryResponse> {
  return apiRequest<AnalyticsQueryResponse>('/api/v1/analytics/query', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function runSqlPreview(payload: SqlPreviewRequest): Promise<SqlPreviewResponse> {
  return apiRequest<SqlPreviewResponse>('/api/v1/analytics/sql/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
