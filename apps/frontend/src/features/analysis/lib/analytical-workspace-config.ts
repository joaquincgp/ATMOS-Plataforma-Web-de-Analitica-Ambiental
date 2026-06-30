import {
  AlertCircle,
  BarChart3,
  Calendar,
  Clock3,
  Database,
  LineChart as LineChartIcon,
  Orbit,
  TrendingUp,
  Upload,
} from 'lucide-react';

import type { AnalyticsDataRow } from '@/api/modules/analytics';

export type ChartType = 'line' | 'bar' | 'scatter' | 'heatmap';
export type TimeGranularity = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export type TimeAggregationMode = 'mean' | 'sum';
export type AggregationMode = 'mean' | 'median' | 'sum' | 'min' | 'max' | 'std';
export type ProfileMode = 'hour' | 'weekday' | 'month' | 'quarter' | 'year';
export type HeatmapProfileMode = 'month' | 'hour' | 'weekday' | 'week';
export type LabSection =
  | 'load-data'
  | 'rolling'
  | 'distribution'
  | 'scatter'
  | 'data_trend'
  | 'time_profiles'
  | 'heat_map'
  | 'seasonality'
  | 'autocorr'
  | 'pacf'
  | 'anomaly'
  | 'decomposition'
  | 'profiles'
  | 'forecast'
  | 'changepoints'
  | 'trend'
  | 'correlation'
  | 'summary';

export const ANALYSIS_SECTIONS: { value: LabSection; label: string; icon: typeof Database; color: string }[] = [
  { value: 'load-data', label: 'Load Data', icon: Upload, color: '#509EE3' },
  { value: 'summary', label: 'Summary', icon: BarChart3, color: '#14B8A6' },
  { value: 'distribution', label: 'Distribution', icon: BarChart3, color: '#509EE3' },
  { value: 'scatter', label: 'Data Scatter', icon: Orbit, color: '#0B7285' },
  { value: 'data_trend', label: 'Data Trend', icon: LineChartIcon, color: '#509EE3' },
  { value: 'time_profiles', label: 'Time Profiles', icon: Clock3, color: '#8B5CF6' },
  { value: 'heat_map', label: 'Heat Map', icon: Calendar, color: '#0B7285' },
  { value: 'rolling', label: 'Rolling Series', icon: LineChartIcon, color: '#1F5A8A' },
  { value: 'anomaly', label: 'Anomaly Detection', icon: AlertCircle, color: '#EF4444' },
  { value: 'profiles', label: 'Temporal Profiles', icon: Clock3, color: '#8B5CF6' },
  { value: 'seasonality', label: 'Calendar Heatmap', icon: Calendar, color: '#0B7285' },
  { value: 'decomposition', label: 'Decomposition', icon: TrendingUp, color: '#1F5A8A' },
  { value: 'autocorr', label: 'ACF', icon: Orbit, color: '#A16207' },
  { value: 'pacf', label: 'PACF', icon: Orbit, color: '#64748B' },
  { value: 'forecast', label: 'Forecasting', icon: TrendingUp, color: '#16A34A' },
  { value: 'changepoints', label: 'Changepoints', icon: AlertCircle, color: '#DC2626' },
  { value: 'trend', label: 'Trend Analysis', icon: TrendingUp, color: '#0EA5E9' },
  { value: 'correlation', label: 'Correlation Matrix', icon: Database, color: '#7C3AED' },
];

export const GRANULARITY_OPTIONS: {
  id: TimeGranularity;
  label: string;
}[] = [
  { id: 'hour', label: 'Hour' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
];

export const RANGE_PRESETS: {
  id: string;
  label: string;
  days: number | null;
}[] = [
  { id: '24h', label: '24h', days: 2 },
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '1y', label: '1y', days: 365 },
  { id: 'all', label: 'All', days: null },
];

const LAB_SECTION_DESCRIPTIONS: Record<Exclude<LabSection, 'load-data'>, string> = {
  rolling: 'Visualize temporal behavior with line, bar, scatter or heatmap views.',
  distribution: 'Inspect histograms, density curves, boxplots and missingness for selected variables.',
  scatter: 'Compare two variables with scatter and regression views.',
  data_trend: 'Track selected variables across time with aggregation and rolling controls.',
  time_profiles: 'Inspect recurring hourly, weekday, monthly and yearly patterns.',
  heat_map: 'Compare temporal intensity patterns in a year-by-calendar heat map.',
  anomaly: 'Detect abnormal behavior using rolling spread and anomaly markers.',
  profiles: 'Inspect recurring hourly, weekly or seasonal profiles.',
  summary: 'Review descriptive statistics for the current data selection.',
  seasonality: 'Compare calendar patterns across the selected date range.',
  decomposition: 'Separate trend, seasonal and residual components.',
  autocorr: 'Inspect lag dependency structure over time.',
  pacf: 'Inspect partial lag dependency structure.',
  forecast: 'Project near-future values using the current series behavior.',
  changepoints: 'Highlight abrupt changes in slope and local structure.',
  trend: 'Compare observed data against linear and quadratic trend lines.',
  correlation: 'Compare variables through correlation heatmaps and pair plots.',
};

export function toIsoDate(value: string | null): string {
  if (!value) {
    return '';
  }
  return value.slice(0, 10);
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeDateRange(from: string, to: string): { from?: string; to?: string } {
  if (!from || !to) {
    return {
      from: from || undefined,
      to: to || undefined,
    };
  }

  if (from <= to) {
    return { from, to };
  }

  return { from: to, to: from };
}

export function isTimeNavigableSection(section: LabSection): boolean {
  return (
    section === 'rolling'
    || section === 'data_trend'
    || section === 'anomaly'
    || section === 'decomposition'
    || section === 'forecast'
    || section === 'changepoints'
    || section === 'trend'
  );
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(baseDate: string, deltaDays: number): string {
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return formatDate(date);
}

export function buildLocalSummary(rows: AnalyticsDataRow[]): {
  samples: number;
  mean: number;
  min: number;
  max: number;
  trend: 'Rising' | 'Falling' | 'Stable';
} {
  if (rows.length === 0) {
    return { samples: 0, mean: 0, min: 0, max: 0, trend: 'Stable' };
  }

  const values = rows.map((row) => row.value);
  const mean = values.reduce((accumulator, value) => accumulator + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const trend = last > first * 1.05 ? 'Rising' : last < first * 0.95 ? 'Falling' : 'Stable';

  return {
    samples: rows.length,
    mean,
    min,
    max,
    trend,
  };
}

export function getLabSectionDescription(section: LabSection): string | null {
  if (section === 'load-data') {
    return null;
  }
  return LAB_SECTION_DESCRIPTIONS[section];
}
