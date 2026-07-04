import { env } from '@/shared/config/env';

import type { AnalyticsQueryResponse } from '@/api/modules/analytics';
import { apiRequest } from '@/api/http-client';

const AUTH_STORAGE_KEY = 'atmos.auth.v1';

function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { accessToken?: string };
    return parsed.accessToken ?? null;
  } catch {
    return null;
  }
}

export interface DbInitResponse {
  status: string;
  database: string;
  timestamp: string;
}

export interface EtlRunResponse {
  id: string;
  trigger_type: string;
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  archives_discovered: number;
  archives_processed: number;
  records_inserted: number;
  records_updated: number;
  records_skipped: number;
  details: Record<string, unknown>;
}

export interface EtlRunHistoryClearResponse {
  cleared: number;
}

export interface EtlMetricsResponse {
  total_measurements: number;
  total_stations: number;
  total_variables: number;
  latest_run_status: string;
}

export interface EtlPreviewRowResponse {
  observed_at: string;
  station_code: string;
  variable_code: string;
  value: number;
  unit: string | null;
  source_file_name: string;
}

export interface EtlPreviewResponse {
  run_id: string | null;
  rows: EtlPreviewRowResponse[];
}

interface ManualDatasetColumnProfile {
  name: string;
  pandas_dtype: string;
  inferred_kind: string;
  null_count: number;
  non_null_count: number;
  unique_count: number;
  sample_values: string[];
}

interface ManualDatasetSummary {
  row_count: number;
  column_count: number;
  numeric_columns: string[];
  categorical_columns: string[];
  datetime_columns: string[];
}

export interface ManualDatasetRoleMapping {
  numeric_columns: string[];
  categorical_columns: string[];
  datetime_column: string | null;
  date_column: string | null;
  time_column: string | null;
  station_code_column: string | null;
  variable_code_column: string | null;
  value_column: string | null;
  unit_column: string | null;
  normalized_datetime_column_name: string;
}

export interface ManualDatasetOperation {
  type:
    | 'select_columns'
    | 'cast_types'
    | 'subsample'
    | 'melt'
    | 'date_features'
    | 'cast_datetime'
    | 'remove_rows'
    | 'impute_knn_mode';
  columns?: string[];
  type_map?: Record<string, string>;
  numeric_columns?: string[];
  categorical_columns?: string[];
  sample_pct?: number;
  id_vars?: string[];
  var_name?: string;
  value_name?: string;
  date_column?: string | null;
  dayfirst?: boolean;
  date_format?: string | null;
  fuzzy_parse?: boolean;
  year_default?: number | null;
}

export interface ManualDatasetResponse {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  source_kind: string;
  source_url: string | null;
  original_file_name: string;
  status: string;
  dataset_kind: string | null;
  storage_format: string;
  row_count: number;
  column_count: number;
  operation_pipeline: ManualDatasetOperation[];
  mapping: ManualDatasetRoleMapping;
  summary: ManualDatasetSummary;
  columns: ManualDatasetColumnProfile[];
  preview_rows: Record<string, unknown>[];
  etl_run_id: string | null;
  source_file_id: number | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  created_for?: string | null;
  source_metadata?: Record<string, unknown> | null;
}

export interface ManualDatasetMissingDataColumn {
  column: string;
  missing_values: number;
  percentage_missing: number;
}

export interface ManualDatasetMissingDataOverviewResponse {
  dataset_id: string;
  dataset_name: string;
  row_count: number;
  column_count: number;
  total_missing_values: number;
  columns: ManualDatasetMissingDataColumn[];
}

export type ManualDatasetMissingDataAction = 'remove_rows' | 'impute_knn_mode';

export interface SyncRemmaqParams {
  forceReprocess?: boolean;
  variableCodes?: string[];
  observedFrom?: string;
  observedTo?: string;
}

export const REMMAQ_VARIABLE_OPTIONS = [
  { code: 'CO', label: 'Monóxido de Carbono (CO)' },
  { code: 'NO2', label: 'Dióxido de Nitrógeno (NO2)' },
  { code: 'O3', label: 'Ozono (O3)' },
  { code: 'PM25', label: 'PM2.5' },
  { code: 'PM10', label: 'PM10' },
  { code: 'SO2', label: 'Dióxido de Azufre (SO2)' },
  { code: 'DIR', label: 'Dirección del Viento (DIR)' },
  { code: 'HUM', label: 'Humedad Relativa (HUM)' },
  { code: 'IUV', label: 'Radiación Ultravioleta (IUV)' },
  { code: 'LLU', label: 'Precipitación (LLU)' },
  { code: 'PRE', label: 'Presión Barométrica (PRE)' },
  { code: 'RS', label: 'Radiación Solar (RS)' },
  { code: 'TMP', label: 'Temperatura Media (TMP)' },
  { code: 'VEL', label: 'Velocidad del Viento (VEL)' },
] as const;

export function initializeDatabase(): Promise<DbInitResponse> {
  return apiRequest<DbInitResponse>('/api/v1/etl/db/init', { method: 'POST' });
}

export function startSyncRemmaq(params: SyncRemmaqParams = {}): Promise<EtlRunResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('force_reprocess', String(params.forceReprocess ?? false));
  if (params.variableCodes?.length) {
    for (const code of params.variableCodes) {
      searchParams.append('variable_codes', code);
    }
  }
  if (params.observedFrom) {
    searchParams.set('observed_from', params.observedFrom);
  }
  if (params.observedTo) {
    searchParams.set('observed_to', params.observedTo);
  }

  return apiRequest<EtlRunResponse>(`/api/v1/etl/sync/remmaq/start?${searchParams.toString()}`, {
    method: 'POST',
  });
}

export async function startUploadEtlFile(file: File, forceReprocess = false): Promise<EtlRunResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const accessToken = getStoredAccessToken();

  const response = await fetch(
    `${env.apiBaseUrl}/api/v1/etl/upload/start?force_reprocess=${forceReprocess}`,
    {
      method: 'POST',
      body: formData,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    },
  );

  if (!response.ok) {
    let detail = `Upload failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Keep fallback detail
    }
    throw new Error(detail);
  }

  return (await response.json()) as EtlRunResponse;
}

export function getEtlRuns(limit = 20): Promise<EtlRunResponse[]> {
  return apiRequest<EtlRunResponse[]>(`/api/v1/etl/runs?limit=${limit}`);
}

export function getEtlRun(runId: string): Promise<EtlRunResponse> {
  return apiRequest<EtlRunResponse>(`/api/v1/etl/runs/${runId}`);
}

export function clearEtlRunHistory(): Promise<EtlRunHistoryClearResponse> {
  return apiRequest<EtlRunHistoryClearResponse>('/api/v1/etl/runs/history', {
    method: 'DELETE',
  });
}

export function getEtlMetrics(): Promise<EtlMetricsResponse> {
  return apiRequest<EtlMetricsResponse>('/api/v1/etl/metrics');
}

export function getEtlPreview(runId?: string, limit = 100): Promise<EtlPreviewResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('limit', String(limit));
  if (runId) {
    searchParams.set('run_id', runId);
  }
  return apiRequest<EtlPreviewResponse>(`/api/v1/etl/preview?${searchParams.toString()}`);
}

export async function uploadManualDataset(workspaceId: string, file: File): Promise<ManualDatasetResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const accessToken = getStoredAccessToken();

  const response = await fetch(`${env.apiBaseUrl}/api/v1/etl/manual-datasets/upload?workspace_id=${workspaceId}`, {
    method: 'POST',
    body: formData,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    let detail = `Upload failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Keep fallback detail
    }
    throw new Error(detail);
  }

  return (await response.json()) as ManualDatasetResponse;
}

export function createManualDatasetFromUrl(payload: {
  workspace_id: string;
  source_url: string;
}): Promise<ManualDatasetResponse> {
  return apiRequest<ManualDatasetResponse>('/api/v1/etl/manual-datasets/from-url', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getManualDatasetAnalyticsPreview(
  datasetId: string,
  payload: {
    limit?: number;
    date_from?: string;
    date_to?: string;
    view_from?: string;
    view_to?: string;
    station_codes?: string[];
    variable_codes?: string[];
  } = {},
): Promise<AnalyticsQueryResponse> {
  const params = new URLSearchParams();
  if (payload.limit !== undefined) {
    params.set('limit', String(payload.limit));
  }
  if (payload.date_from) {
    params.set('date_from', payload.date_from);
  }
  if (payload.date_to) {
    params.set('date_to', payload.date_to);
  }
  if (payload.view_from) {
    params.set('view_from', payload.view_from);
  }
  if (payload.view_to) {
    params.set('view_to', payload.view_to);
  }
  for (const stationCode of payload.station_codes ?? []) {
    params.append('station_codes', stationCode);
  }
  for (const variableCode of payload.variable_codes ?? []) {
    params.append('variable_codes', variableCode);
  }
  return apiRequest<AnalyticsQueryResponse>(`/api/v1/etl/manual-datasets/${datasetId}/analytics-preview?${params.toString()}`);
}

export function getManualDatasetMissingDataOverview(
  datasetId: string,
): Promise<ManualDatasetMissingDataOverviewResponse> {
  return apiRequest<ManualDatasetMissingDataOverviewResponse>(
    `/api/v1/etl/manual-datasets/${datasetId}/missing-data`,
  );
}

export function applyManualDatasetMissingDataAction(
  datasetId: string,
  payload: {
    action: ManualDatasetMissingDataAction;
    dataset_name?: string;
  },
): Promise<ManualDatasetResponse> {
  return apiRequest<ManualDatasetResponse>(`/api/v1/etl/manual-datasets/${datasetId}/missing-data`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listManualDatasets(workspaceId: string): Promise<ManualDatasetResponse[]> {
  return apiRequest<ManualDatasetResponse[]>(`/api/v1/etl/manual-datasets?workspace_id=${workspaceId}`);
}

export async function downloadManualDataset(datasetId: string): Promise<{ blob: Blob; filename: string }> {
  const accessToken = getStoredAccessToken();
  const response = await fetch(`${env.apiBaseUrl}/api/v1/etl/manual-datasets/${datasetId}/download`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    let detail = `Download failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Keep fallback detail
    }
    throw new Error(detail);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const quotedMatch = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = encodedMatch?.[1]
    ? decodeURIComponent(encodedMatch[1])
    : (quotedMatch?.[1] ?? `dataset-${datasetId}.csv`);

  return { blob: await response.blob(), filename };
}

export function previewManualDataset(
  datasetId: string,
  payload: {
    operation_pipeline: ManualDatasetOperation[];
    mapping: ManualDatasetRoleMapping;
  },
): Promise<ManualDatasetResponse> {
  return apiRequest<ManualDatasetResponse>(`/api/v1/etl/manual-datasets/${datasetId}/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function finalizeManualDataset(
  datasetId: string,
  payload: {
    dataset_name?: string;
    operation_pipeline: ManualDatasetOperation[];
    mapping: ManualDatasetRoleMapping;
  },
): Promise<ManualDatasetResponse> {
  return apiRequest<ManualDatasetResponse>(`/api/v1/etl/manual-datasets/${datasetId}/finalize`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteManualDataset(datasetId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/etl/manual-datasets/${datasetId}`, {
    method: 'DELETE',
  });
}
