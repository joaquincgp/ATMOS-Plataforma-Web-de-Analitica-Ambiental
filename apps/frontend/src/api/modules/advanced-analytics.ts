import { apiRequest } from '@/api/http-client';

export type AdvancedModel = 'arima' | 'sarima' | 'prophet';

export interface AdvancedAnalyticsRequest {
  source_file_ids?: number[];
  manual_dataset_id?: string | null;
  station_codes?: string[];
  variable_codes?: string[];
  date_from?: string;
  date_to?: string;
  view_from?: string;
  view_to?: string;
  granularity?: 'hour' | 'day' | 'month' | 'year';
  x_axis?: string;
  y_axis?: string;
  model?: AdvancedModel;
  horizon?: number;
  order?: number[];
  seasonal_order?: number[];
}

export interface AdvancedAnalyticsResponse {
  figure_json: {
    data?: unknown[];
    layout?: Record<string, unknown>;
    frames?: unknown[];
  };
  stats: Record<string, unknown>;
  warnings: string[];
}

export function runAdvancedForecast(payload: AdvancedAnalyticsRequest): Promise<AdvancedAnalyticsResponse> {
  return apiRequest<AdvancedAnalyticsResponse>('/api/v1/advanced-analytics/forecast', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
