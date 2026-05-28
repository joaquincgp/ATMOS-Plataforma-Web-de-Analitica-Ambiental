import { apiRequest } from '@/api/http-client';

export type EdaSection =
  | 'rolling'
  | 'distribution'
  | 'scatter'
  | 'data_trend'
  | 'time_profiles'
  | 'heat_map'
  | 'anomaly'
  | 'profiles'
  | 'seasonality'
  | 'decomposition'
  | 'autocorr'
  | 'pacf'
  | 'forecast'
  | 'changepoints'
  | 'trend'
  | 'correlation'
  | 'summary';

export type EdaChartType =
  | 'line'
  | 'bar'
  | 'scatter'
  | 'heatmap'
  | 'histogram'
  | 'kde'
  | 'density2'
  | 'box'
  | 'violin'
  | 'lineplot'
  | 'catplot'
  | 'regression'
  | 'pairplot'
  | 'missing'
  | 'ridge'
  | 'clustermap';

export interface EdaPlotRequest {
  section: EdaSection;
  source_file_ids?: number[];
  manual_dataset_id?: string | null;
  station_codes?: string[];
  variable_codes?: string[];
  date_from?: string;
  date_to?: string;
  view_from?: string;
  view_to?: string;
  limit?: number;
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  time_aggregation?: 'mean' | 'sum';
  chart_type?: EdaChartType | null;
  rolling_window?: number;
  decomposition_window?: number;
  forecast_horizon?: number;
  changepoint_window?: number;
  changepoint_sensitivity?: number;
  profile_mode?: 'hour' | 'weekday' | 'month' | 'quarter' | 'year';
  profile_aggregation?: 'mean' | 'median' | 'sum' | 'min' | 'max' | 'std';
  profile_heatmap_mode?: 'month' | 'hour' | 'weekday' | 'week';
  trend_deseasonalized?: boolean;
  pair_variable_x?: string;
  pair_variable_y?: string;
  x_axis?: string;
  y_axis?: string;
  hue?: string;
  facet_row?: string;
  facet_col?: string;
  category_order?: string[];
  time_is_here?: boolean;
  show_std_band?: boolean;
  show_markers?: boolean;
  cumulative?: boolean;
  normalize_density?: boolean;
  swarm_overlay?: boolean;
  histogram_bins?: number;
  histogram_stat?: 'count' | 'probability' | 'percent' | 'density';
  histogram_mode?: 'overlay' | 'group' | 'stack';
  histogram_element?: 'bars' | 'step';
  density_kind?: 'heatmap' | 'contour';
  missing_plot_type?: 'matrix' | 'bars' | 'heatmap';
  color_scale?: string;
  regression_order?: number;
  confidence_level?: number;
  marker_opacity?: number;
  marker_size?: number;
  facet_variables?: boolean;
  same_y_axis?: boolean;
  facet_columns?: number;
}

export interface EdaSecondaryFigure {
  key: string;
  title: string;
  description: string | null;
  figure_json: {
    data?: unknown[];
    layout?: Record<string, unknown>;
    frames?: unknown[];
  };
}

export interface EdaPlotResponse {
  figure_json: {
    data?: unknown[];
    layout?: Record<string, unknown>;
    frames?: unknown[];
  };
  secondary_figures: EdaSecondaryFigure[];
  stats: Record<string, unknown>;
  warnings: string[];
}

export function runEdaPlot(payload: EdaPlotRequest): Promise<EdaPlotResponse> {
  return apiRequest<EdaPlotResponse>('/api/v1/eda/plot', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
