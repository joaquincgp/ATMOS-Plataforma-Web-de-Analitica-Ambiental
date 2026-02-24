import { env } from '@/shared/config/env';

import { apiRequest } from '@/api/http-client';

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

export interface SyncRemmaqParams {
  forceReprocess?: boolean;
  variableCodes?: string[];
  maxArchives?: number;
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

export function syncRemmaq(params: SyncRemmaqParams = {}): Promise<EtlRunResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('force_reprocess', String(params.forceReprocess ?? false));
  if (params.maxArchives && params.maxArchives > 0) {
    searchParams.set('max_archives', String(params.maxArchives));
  }
  if (params.variableCodes?.length) {
    for (const code of params.variableCodes) {
      searchParams.append('variable_codes', code);
    }
  }

  return apiRequest<EtlRunResponse>(`/api/v1/etl/sync/remmaq?${searchParams.toString()}`, {
    method: 'POST',
  });
}

export async function uploadEtlFile(file: File, forceReprocess = false): Promise<EtlRunResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${env.apiBaseUrl}/api/v1/etl/upload?force_reprocess=${forceReprocess}`,
    {
      method: 'POST',
      body: formData,
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
