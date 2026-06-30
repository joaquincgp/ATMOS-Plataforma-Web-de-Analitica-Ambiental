import { apiRequest } from '@/api/http-client';

interface PublicAirQualityVariableOption {
  code: string;
  name: string;
  category: string;
  unit: string | null;
}

export interface PublicStationObservation {
  station_code: string;
  station_name: string;
  latitude: number;
  longitude: number;
  region: string | null;
  latest_value: number;
  mean_value: number;
  min_value: number;
  max_value: number;
  sample_count: number;
  unit: string | null;
  latest_observed_at: string;
  variables: PublicStationVariableObservation[];
}

interface PublicStationVariableObservation {
  variable_code: string;
  variable_name: string;
  category: string;
  value: number;
  unit: string | null;
  observed_at: string;
}

interface PublicTimeSeriesPoint {
  timestamp: string;
  mean_value: number;
  min_value: number;
  max_value: number;
  sample_count: number;
}

export interface PublicMeteorologySummary {
  variable_code: string;
  variable_name: string;
  unit: string | null;
  mean_value: number | null;
  latest_value: number | null;
  latest_observed_at: string | null;
  sample_count: number;
}

export interface PublicVariableSummary {
  variable_code: string;
  variable_name: string;
  category: string;
  unit: string | null;
  mean_value: number | null;
  min_value: number | null;
  max_value: number | null;
  latest_value: number | null;
  latest_observed_at: string | null;
  first_available_at: string | null;
  latest_available_at: string | null;
  latest_ingested_at: string | null;
  total_sample_count: number;
  today_sample_count: number;
  sample_count: number;
  station_count: number;
}

interface PublicSyncSummary {
  status: string;
  latest_run_started_at: string | null;
  latest_run_finished_at: string | null;
  latest_source_downloaded_at: string | null;
  latest_source_processed_at: string | null;
  records_today: number;
  records_inserted: number;
  records_updated: number;
  records_skipped: number;
  archives_processed: number;
}

interface PublicPeriodSummary {
  max_value: number | null;
  avg_value: number | null;
  rds: number;
  sample_count: number;
  station_count: number;
  unit: string | null;
  date_from: string | null;
  date_to: string | null;
}

export interface PublicAirQualityResponse {
  variable_code: string;
  variable_name: string;
  unit: string | null;
  date_from: string | null;
  date_to: string | null;
  generated_at: string;
  latest_observed_at: string | null;
  latest_ingested_at: string | null;
  today_observation_count: number;
  station_count: number;
  observation_count: number;
  variables: PublicAirQualityVariableOption[];
  stations: PublicStationObservation[];
  time_series: PublicTimeSeriesPoint[];
  meteorology: PublicMeteorologySummary[];
  variable_summaries: PublicVariableSummary[];
  period_summary: PublicPeriodSummary;
  sync: PublicSyncSummary;
  methodology_notes: string[];
}

export interface PublicAirQualityParams {
  variable_code?: string;
  hours?: number;
  date_from?: string;
  date_to?: string;
  period?: string;
  hour?: number;
  station_code?: string;
  sync?: boolean;
  force_sync?: boolean;
}

export function getPublicAirQuality(params: PublicAirQualityParams): Promise<PublicAirQualityResponse> {
  const queryParams: Record<string, string | number | boolean | undefined> = {
    variable_code: params.variable_code,
    hours: params.hours,
    date_from: params.date_from,
    date_to: params.date_to,
    period: params.period,
    hour: params.hour,
    station_code: params.station_code,
    sync: params.sync,
    force_sync: params.force_sync,
  };

  return apiRequest<PublicAirQualityResponse>('/api/v1/public/air-quality', {
    auth: false,
    params: queryParams,
  });
}
