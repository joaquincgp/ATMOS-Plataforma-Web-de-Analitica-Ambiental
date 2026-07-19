import { env } from '@/shared/config/env';

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

export interface AnalyticsSourceOption {
  id: number;
  name: string;
  source_type: string;
  etl_run_id: string;
  downloaded_at: string | null;
  row_count: number;
  variable_codes: string[];
  period_start: string | null;
  period_end: string | null;
  downloaded_by: string | null;
}

interface AnalyticsStationOption {
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  region: string | null;
}

interface AnalyticsVariableOption {
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
  view_from?: string;
  view_to?: string;
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

export function getAnalyticsFilters(): Promise<AnalyticsFilterOptionsResponse> {
  return apiRequest<AnalyticsFilterOptionsResponse>('/api/v1/analytics/filters');
}

export function runAnalyticsQuery(payload: AnalyticsQueryRequest): Promise<AnalyticsQueryResponse> {
  return apiRequest<AnalyticsQueryResponse>('/api/v1/analytics/query', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function exportAnalyticsQuery(payload: AnalyticsQueryRequest): Promise<{ blob: Blob; filename: string }> {
  const accessToken = getStoredAccessToken();
  const response = await fetch(`${env.apiBaseUrl}/api/v1/analytics/export`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    let detail = `Export failed: ${response.status}`;
    try {
      const errorPayload = (await response.json()) as { detail?: string };
      if (errorPayload.detail) {
        detail = errorPayload.detail;
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
    : quotedMatch?.[1] ?? 'remmaq-records.csv';

  return { blob: await response.blob(), filename };
}
