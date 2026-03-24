import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  Clock3,
  Database,
  FileSpreadsheet,
  LineChart as LineChartIcon,
  Loader2,
  MapPin,
  Orbit,
  Search,
  Table2,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  getAnalyticsFilters,
  runAnalyticsQuery,
  type AnalyticsDataRow,
  type AnalyticsFilterOptionsResponse,
  type AnalyticsQueryRequest,
} from '@/api/modules/analytics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type ChartType = 'line' | 'bar' | 'scatter' | 'heatmap';
type TimeGranularity = 'hour' | 'day' | 'month' | 'year';

interface TemporalPoint {
  bucket: string;
  overall: number;
  [key: string]: string | number;
}

interface StationBarPoint {
  station: string;
  avg: number;
}

interface ScatterPoint {
  hour: number;
  value: number;
}

interface HistogramPoint {
  range: string;
  count: number;
}

interface HeatMatrix {
  days: string[];
  hours: number[];
  values: Map<string, number>;
}

interface SummaryStats {
  samples: number;
  mean: number;
  min: number;
  max: number;
  trend: 'Rising' | 'Falling' | 'Stable';
}

type AggregationMode = 'mean' | 'median' | 'sum' | 'min' | 'max' | 'std';
type ProfileMode = 'hour' | 'weekday' | 'month' | 'quarter' | 'year';
type HeatmapProfileMode = 'month' | 'hour' | 'weekday' | 'week';
type LabSection =
  | 'load-data'
  | 'rolling'
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

interface ForecastPoint {
  bucket: string;
  observed: number | null;
  forecast: number;
  upper: number;
  lower: number;
}

interface ChangepointMarker {
  bucket: string;
  score: number;
  value: number;
}

interface TrendDiagnostics {
  linearSlope: number;
  linearIntercept: number;
  linearR2: number;
  trendDirection: 'Rising' | 'Falling' | 'Stable';
}

interface CorrelationCell {
  x: string;
  y: string;
  value: number;
}

interface CorrelationMatrixResult {
  variables: string[];
  cells: CorrelationCell[];
}

interface ProfileHeatmap {
  xLabels: string[];
  yLabels: string[];
  values: Map<string, number>;
}

interface VariablePairPoint {
  bucket: string;
  x: number;
  y: number;
}

const CHART_OPTIONS: {
  id: ChartType;
  label: string;
  icon: typeof LineChartIcon;
}[] = [
  { id: 'line', label: 'Line', icon: LineChartIcon },
  { id: 'bar', label: 'Bar', icon: BarChart3 },
  { id: 'scatter', label: 'Scatter', icon: Orbit },
  { id: 'heatmap', label: 'Heatmap', icon: Table2 },
];

const ANALYSIS_SECTIONS: { value: LabSection; label: string; icon: typeof Database; color: string }[] = [
  { value: 'load-data', label: 'Load Data', icon: Upload, color: '#509EE3' },
  { value: 'rolling', label: 'Time Series', icon: LineChartIcon, color: '#509EE3' },
  { value: 'anomaly', label: 'Anomaly Detection', icon: AlertCircle, color: '#EF4444' },
  { value: 'profiles', label: 'Temporal Profiles', icon: Clock3, color: '#8B5CF6' },
  { value: 'summary', label: 'Statistical Summary', icon: BarChart3, color: '#14B8A6' },
  { value: 'seasonality', label: 'Calendar Heatmap', icon: Calendar, color: '#0B7285' },
  { value: 'decomposition', label: 'Decomposition', icon: TrendingUp, color: '#1F5A8A' },
  { value: 'autocorr', label: 'ACF', icon: Orbit, color: '#A16207' },
  { value: 'pacf', label: 'PACF', icon: Orbit, color: '#64748B' },
  { value: 'forecast', label: 'Forecasting', icon: TrendingUp, color: '#16A34A' },
  { value: 'changepoints', label: 'Changepoints', icon: AlertCircle, color: '#DC2626' },
  { value: 'trend', label: 'Trend Analysis', icon: TrendingUp, color: '#0EA5E9' },
  { value: 'correlation', label: 'Correlation Matrix', icon: Table2, color: '#7C3AED' },
];

const GRANULARITY_OPTIONS: {
  id: TimeGranularity;
  label: string;
}[] = [
  { id: 'hour', label: 'Hour' },
  { id: 'day', label: 'Day' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

const RANGE_PRESETS: {
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

const CHART_COLORS = ['#509EE3', '#1F5A8A', '#0EA5E9', '#0B7285', '#16A34A', '#E9730C', '#D946EF', '#A16207'];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function safeMean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((accumulator, value) => accumulator + value, 0) / values.length;
}

function safeStd(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const mean = safeMean(values);
  const variance = values.reduce((accumulator, value) => accumulator + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function safeMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

function aggregateValues(values: number[], mode: AggregationMode): number {
  if (values.length === 0) {
    return 0;
  }

  if (mode === 'sum') {
    return values.reduce((accumulator, value) => accumulator + value, 0);
  }
  if (mode === 'min') {
    return Math.min(...values);
  }
  if (mode === 'max') {
    return Math.max(...values);
  }
  if (mode === 'median') {
    return safeMedian(values);
  }
  if (mode === 'std') {
    return safeStd(values);
  }
  return safeMean(values);
}

function getSeasonalPeriod(granularity: TimeGranularity): number {
  if (granularity === 'hour') {
    return 24;
  }
  if (granularity === 'day') {
    return 7;
  }
  if (granularity === 'month') {
    return 12;
  }
  return 5;
}

function toIsoDate(value: string | null): string {
  if (!value) {
    return '';
  }
  return value.slice(0, 10);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeDateRange(from: string, to: string): { from?: string; to?: string } {
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

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(baseDate: string, deltaDays: number): string {
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return formatDate(date);
}

function applyExploreRange(
  fromDate: string,
  toDate: string,
  rangePercent: [number, number],
): { from: string; to: string } {
  if (!fromDate || !toDate) {
    return { from: fromDate, to: toDate };
  }

  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const toMs = new Date(`${toDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return { from: fromDate, to: toDate };
  }

  const totalSpan = toMs - fromMs;
  const startPct = Math.max(0, Math.min(100, rangePercent[0]));
  const endPct = Math.max(startPct, Math.min(100, rangePercent[1]));

  const startMs = fromMs + (totalSpan * startPct) / 100;
  const endMs = fromMs + (totalSpan * endPct) / 100;

  return {
    from: formatDate(new Date(startMs)),
    to: formatDate(new Date(endMs)),
  };
}

function getBucketKey(observedAt: string, granularity: TimeGranularity): string {
  const dt = new Date(observedAt);
  const year = dt.getUTCFullYear();
  const month = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${dt.getUTCDate()}`.padStart(2, '0');
  const hour = `${dt.getUTCHours()}`.padStart(2, '0');

  if (granularity === 'year') {
    return `${year}`;
  }
  if (granularity === 'month') {
    return `${year}-${month}`;
  }
  if (granularity === 'hour') {
    return `${year}-${month}-${day} ${hour}:00`;
  }
  return `${year}-${month}-${day}`;
}

function computeTemporalSeries(
  rows: AnalyticsDataRow[],
  granularity: TimeGranularity,
  splitByStation: boolean,
): { points: TemporalPoint[]; keys: string[] } {
  const bucketMap = new Map<string, Map<string, { sum: number; count: number }>>();
  const seriesCounter = new Map<string, number>();

  for (const row of rows) {
    const bucket = getBucketKey(row.observed_at, granularity);
    const seriesKey = splitByStation ? row.station_code : row.variable_code;

    const seriesBuckets = bucketMap.get(bucket) ?? new Map<string, { sum: number; count: number }>();

    const item = seriesBuckets.get(seriesKey) ?? { sum: 0, count: 0 };
    item.sum += row.value;
    item.count += 1;
    seriesBuckets.set(seriesKey, item);

    const overall = seriesBuckets.get('overall') ?? { sum: 0, count: 0 };
    overall.sum += row.value;
    overall.count += 1;
    seriesBuckets.set('overall', overall);

    bucketMap.set(bucket, seriesBuckets);
    seriesCounter.set(seriesKey, (seriesCounter.get(seriesKey) ?? 0) + 1);
  }

  const points: TemporalPoint[] = Array.from(bucketMap.entries())
    .map(([bucket, grouped]) => {
      const point: TemporalPoint = { bucket, overall: 0 };
      for (const [key, values] of grouped.entries()) {
        point[key] = values.sum / values.count;
      }
      point.overall = Number(point.overall ?? 0);
      return point;
    })
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));

  const keys = Array.from(seriesCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const effectiveKeys = splitByStation ? keys : keys.slice(0, 4);
  return { points, keys: effectiveKeys };
}

function computeStationBars(rows: AnalyticsDataRow[]): StationBarPoint[] {
  const grouped = new Map<string, { sum: number; count: number }>();

  for (const row of rows) {
    const bucket = grouped.get(row.station_code) ?? { sum: 0, count: 0 };
    bucket.sum += row.value;
    bucket.count += 1;
    grouped.set(row.station_code, bucket);
  }

  return Array.from(grouped.entries())
    .map(([station, aggregate]) => ({
      station,
      avg: aggregate.sum / aggregate.count,
    }))
    .sort((a, b) => b.avg - a.avg);
}

function computeScatterByStation(rows: AnalyticsDataRow[]): Record<string, ScatterPoint[]> {
  const output: Record<string, ScatterPoint[]> = {};
  for (const row of rows.slice(0, 4000)) {
    const dt = new Date(row.observed_at);
    const hour = round(dt.getUTCHours() + dt.getUTCMinutes() / 60, 2);
    if (!output[row.station_code]) {
      output[row.station_code] = [];
    }
    output[row.station_code].push({ hour, value: row.value });
  }
  return output;
}

function computeHistogram(rows: AnalyticsDataRow[], bins = 16): HistogramPoint[] {
  if (rows.length === 0) {
    return [];
  }

  const values = rows.map((row) => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (Math.abs(max - min) < 1e-9) {
    return [{ range: `${round(min)}-${round(max)}`, count: rows.length }];
  }

  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, () => 0);

  for (const value of values) {
    const index = Math.min(bins - 1, Math.floor((value - min) / width));
    buckets[index] += 1;
  }

  return buckets.map((count, index) => {
    const start = min + width * index;
    const end = start + width;
    return {
      range: `${round(start)}-${round(end)}`,
      count,
    };
  });
}

function computeHeatmap(rows: AnalyticsDataRow[]): HeatMatrix {
  const grouped = new Map<string, { sum: number; count: number }>();
  const daySet = new Set<string>();

  for (const row of rows) {
    const dt = new Date(row.observed_at);
    const day = `${dt.getUTCFullYear()}-${`${dt.getUTCMonth() + 1}`.padStart(2, '0')}-${`${dt.getUTCDate()}`.padStart(2, '0')}`;
    const hour = dt.getUTCHours();
    const key = `${day}|${hour}`;

    const bucket = grouped.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += row.value;
    bucket.count += 1;
    grouped.set(key, bucket);
    daySet.add(day);
  }

  const days = Array.from(daySet.values()).sort().slice(-14);
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const values = new Map<string, number>();

  for (const day of days) {
    for (const hour of hours) {
      const key = `${day}|${hour}`;
      const item = grouped.get(key);
      if (item) {
        values.set(key, item.sum / item.count);
      }
    }
  }

  return { days, hours, values };
}

function buildSummary(rows: AnalyticsDataRow[], temporalSeries: TemporalPoint[]): SummaryStats {
  if (rows.length === 0) {
    return { samples: 0, mean: 0, min: 0, max: 0, trend: 'Stable' };
  }

  const values = rows.map((row) => row.value);
  const mean = values.reduce((accumulator, value) => accumulator + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  let trend: SummaryStats['trend'] = 'Stable';
  if (temporalSeries.length >= 2) {
    const first = Number(temporalSeries[0].overall ?? 0);
    const last = Number(temporalSeries[temporalSeries.length - 1].overall ?? 0);
    const delta = last - first;
    const threshold = Math.max(0.05, Math.abs(mean) * 0.02);
    if (delta > threshold) {
      trend = 'Rising';
    } else if (delta < -threshold) {
      trend = 'Falling';
    }
  }

  return {
    samples: rows.length,
    mean,
    min,
    max,
    trend,
  };
}

function computeRollingStats(points: TemporalPoint[], windowSize: number): TemporalPoint[] {
  if (points.length === 0) {
    return [];
  }

  const safeWindow = Math.max(2, Math.min(90, windowSize));
  return points.map((point, index) => {
    const slice = points.slice(Math.max(0, index - safeWindow + 1), index + 1);
    const values = slice.map((item) => Number(item.overall ?? 0));
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    return {
      bucket: String(point.bucket),
      overall: Number(point.overall ?? 0),
      mean,
      upper: mean + std,
      lower: mean - std,
    };
  });
}

function computeSeasonalProfile(
  rows: AnalyticsDataRow[],
  mode: 'weekday' | 'month' | 'hour',
  aggregationMode: AggregationMode,
): TemporalPoint[] {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const dt = new Date(row.observed_at);
    let key = '';
    if (mode === 'weekday') {
      key = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()] ?? 'N/A';
    } else if (mode === 'month') {
      key = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
    } else {
      key = `${dt.getUTCHours()}`.padStart(2, '0');
    }
    const current = grouped.get(key) ?? [];
    current.push(row.value);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([bucket, values]) => ({
      bucket,
      overall: aggregateValues(values, aggregationMode),
    }))
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

function computeAutocorrelation(points: TemporalPoint[], maxLag = 30): TemporalPoint[] {
  const values = points.map((point) => Number(point.overall ?? 0));
  if (values.length < 3) {
    return [];
  }

  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const denominator = values.reduce((acc, value) => acc + (value - mean) ** 2, 0);
  if (denominator <= 1e-12) {
    return [];
  }

  const lagLimit = Math.min(maxLag, values.length - 2);
  const result: TemporalPoint[] = [];
  for (let lag = 1; lag <= lagLimit; lag += 1) {
    let numerator = 0;
    for (let index = lag; index < values.length; index += 1) {
      numerator += (values[index] - mean) * (values[index - lag] - mean);
    }
    result.push({
      bucket: `Lag ${lag}`,
      overall: numerator / denominator,
    });
  }

  return result;
}

function computeAnomalySeries(points: TemporalPoint[]): TemporalPoint[] {
  const values = points.map((point) => Number(point.overall ?? 0));
  if (values.length < 5) {
    return points;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0] ?? 0;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1] ?? 0;
  const iqr = q3 - q1;
  const lower = q1 - iqr * 1.5;
  const upper = q3 + iqr * 1.5;

  return points.map((point) => {
    const value = Number(point.overall ?? 0);
    return {
      bucket: String(point.bucket),
      overall: value,
      is_anomaly: value < lower || value > upper ? 1 : 0,
      anomaly_value: value < lower || value > upper ? value : Number.NaN,
      lower,
      upper,
    };
  });
}

function computeDecompositionSeries(
  points: TemporalPoint[],
  granularity: TimeGranularity,
  trendWindow: number,
): TemporalPoint[] {
  if (points.length === 0) {
    return [];
  }

  const values = points.map((point) => Number(point.overall ?? 0));
  const safeWindow = Math.max(2, Math.min(90, trendWindow));
  const trendValues = values.map((_, index) => {
    const from = Math.max(0, index - safeWindow + 1);
    return safeMean(values.slice(from, index + 1));
  });

  const period = Math.max(2, Math.min(getSeasonalPeriod(granularity), values.length));
  const seasonalSums = Array.from({ length: period }, () => 0);
  const seasonalCounts = Array.from({ length: period }, () => 0);

  for (let index = 0; index < values.length; index += 1) {
    const phase = index % period;
    const detrended = values[index] - trendValues[index];
    seasonalSums[phase] += detrended;
    seasonalCounts[phase] += 1;
  }

  const seasonalTemplate = seasonalSums.map((sum, index) => {
    const count = seasonalCounts[index];
    return count > 0 ? sum / count : 0;
  });
  const seasonalCenter = safeMean(seasonalTemplate);
  const centeredTemplate = seasonalTemplate.map((value) => value - seasonalCenter);

  return points.map((point, index) => {
    const observed = values[index];
    const trend = trendValues[index];
    const seasonal = centeredTemplate[index % period] ?? 0;
    const residual = observed - trend - seasonal;
    return {
      bucket: String(point.bucket),
      overall: observed,
      trend,
      seasonal,
      residual,
    };
  });
}

function autocorrelationAtLag(values: number[], lag: number): number {
  if (values.length === 0 || lag >= values.length) {
    return 0;
  }

  const mean = safeMean(values);
  const denominator = values.reduce((accumulator, value) => accumulator + (value - mean) ** 2, 0);
  if (Math.abs(denominator) < 1e-12) {
    return 0;
  }

  let numerator = 0;
  for (let index = lag; index < values.length; index += 1) {
    numerator += (values[index] - mean) * (values[index - lag] - mean);
  }
  return numerator / denominator;
}

function computePartialAutocorrelation(points: TemporalPoint[], maxLag = 30): TemporalPoint[] {
  const values = points.map((point) => Number(point.overall ?? 0));
  if (values.length < 4) {
    return [];
  }

  const lagLimit = Math.min(maxLag, values.length - 2);
  if (lagLimit < 1) {
    return [];
  }

  const acf = Array.from({ length: lagLimit + 1 }, (_, lag) => autocorrelationAtLag(values, lag));
  const phi: number[][] = Array.from({ length: lagLimit + 1 }, () => []);
  const variance: number[] = Array.from({ length: lagLimit + 1 }, () => 0);

  phi[1][1] = acf[1] ?? 0;
  variance[1] = Math.max(1e-9, 1 - (phi[1][1] ?? 0) ** 2);

  for (let lag = 2; lag <= lagLimit; lag += 1) {
    let numerator = acf[lag] ?? 0;
    for (let k = 1; k <= lag - 1; k += 1) {
      numerator -= (phi[lag - 1]?.[k] ?? 0) * (acf[lag - k] ?? 0);
    }

    const denominator = Math.max(variance[lag - 1] ?? 1e-9, 1e-9);
    phi[lag][lag] = numerator / denominator;

    for (let k = 1; k <= lag - 1; k += 1) {
      phi[lag][k] = (phi[lag - 1]?.[k] ?? 0) - (phi[lag][lag] ?? 0) * (phi[lag - 1]?.[lag - k] ?? 0);
    }

    variance[lag] = Math.max(1e-9, (variance[lag - 1] ?? 1e-9) * (1 - (phi[lag][lag] ?? 0) ** 2));
  }

  return Array.from({ length: lagLimit }, (_, index) => ({
    bucket: `Lag ${index + 1}`,
    overall: phi[index + 1]?.[index + 1] ?? 0,
  }));
}

function incrementBucket(bucket: string, granularity: TimeGranularity, step: number): string {
  if (granularity === 'year') {
    const value = Number(bucket);
    if (Number.isFinite(value)) {
      return `${value + step}`;
    }
    return `F+${step}`;
  }

  if (granularity === 'month') {
    const date = new Date(`${bucket}-01T00:00:00Z`);
    if (Number.isFinite(date.getTime())) {
      date.setUTCMonth(date.getUTCMonth() + step);
      return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}`;
    }
    return `F+${step}`;
  }

  if (granularity === 'hour') {
    const normalized = bucket.includes(' ') ? bucket.replace(' ', 'T') : bucket;
    const date = new Date(`${normalized}:00Z`);
    if (Number.isFinite(date.getTime())) {
      date.setUTCHours(date.getUTCHours() + step);
      return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}-${`${date.getUTCDate()}`.padStart(2, '0')} ${`${date.getUTCHours()}`.padStart(2, '0')}:00`;
    }
    return `F+${step}`;
  }

  const date = new Date(`${bucket}T00:00:00Z`);
  if (Number.isFinite(date.getTime())) {
    date.setUTCDate(date.getUTCDate() + step);
    return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}-${`${date.getUTCDate()}`.padStart(2, '0')}`;
  }
  return `F+${step}`;
}

function fitLinearRegression(values: number[]): { slope: number; intercept: number; r2: number; predicted: number[] } {
  if (values.length === 0) {
    return { slope: 0, intercept: 0, r2: 0, predicted: [] };
  }

  const count = values.length;
  const sumX = ((count - 1) * count) / 2;
  const sumY = values.reduce((accumulator, value) => accumulator + value, 0);
  const sumXY = values.reduce((accumulator, value, index) => accumulator + index * value, 0);
  const sumX2 = values.reduce((accumulator, _, index) => accumulator + index * index, 0);
  const denominator = count * sumX2 - sumX ** 2;

  const slope = Math.abs(denominator) < 1e-9 ? 0 : (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const predicted = values.map((_, index) => intercept + slope * index);

  const meanY = safeMean(values);
  const ssTot = values.reduce((accumulator, value) => accumulator + (value - meanY) ** 2, 0);
  const ssRes = values.reduce(
    (accumulator, value, index) => accumulator + (value - (predicted[index] ?? 0)) ** 2,
    0,
  );
  const r2 = ssTot <= 1e-9 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2, predicted };
}

function computeForecastSeries(
  points: TemporalPoint[],
  granularity: TimeGranularity,
  horizon: number,
  decompositionSeries: TemporalPoint[],
): ForecastPoint[] {
  if (points.length === 0) {
    return [];
  }

  const values = points.map((point) => Number(point.overall ?? 0));
  const linear = fitLinearRegression(values);
  const period = Math.max(2, Math.min(getSeasonalPeriod(granularity), values.length));
  const seasonalTemplate = Array.from({ length: period }, (_, index) => {
    const sample = decompositionSeries[index]?.seasonal;
    return Number.isFinite(sample) ? Number(sample) : 0;
  });

  const fitted = values.map((_, index) => {
    const seasonal = seasonalTemplate[index % period] ?? 0;
    return (linear.intercept + linear.slope * index) + seasonal;
  });
  const residualStd = safeStd(values.map((value, index) => value - (fitted[index] ?? 0)));
  const confidencePadding = residualStd * 1.96;

  const history: ForecastPoint[] = points.map((point, index) => {
    const forecast = fitted[index] ?? 0;
    return {
      bucket: String(point.bucket),
      observed: values[index] ?? 0,
      forecast,
      upper: forecast + confidencePadding,
      lower: forecast - confidencePadding,
    };
  });

  const lastBucket = String(points[points.length - 1]?.bucket ?? '');
  const future: ForecastPoint[] = Array.from({ length: Math.max(1, horizon) }, (_, index) => {
    const absoluteIndex = values.length + index;
    const forecast = (linear.intercept + linear.slope * absoluteIndex) + (seasonalTemplate[absoluteIndex % period] ?? 0);
    return {
      bucket: incrementBucket(lastBucket, granularity, index + 1),
      observed: null,
      forecast,
      upper: forecast + confidencePadding,
      lower: forecast - confidencePadding,
    };
  });

  return [...history, ...future];
}

function detectChangepoints(
  points: TemporalPoint[],
  rollingWindow: number,
  sensitivity: number,
): { markers: ChangepointMarker[]; threshold: number } {
  if (points.length < 6) {
    return { markers: [], threshold: 0 };
  }

  const values = points.map((point) => Number(point.overall ?? 0));
  const smooth = values.map((_, index) => {
    const from = Math.max(0, index - rollingWindow + 1);
    return safeMean(values.slice(from, index + 1));
  });

  const scores: number[] = [];
  for (let index = 1; index < smooth.length; index += 1) {
    scores.push(Math.abs((smooth[index] ?? 0) - (smooth[index - 1] ?? 0)));
  }

  const threshold = safeStd(scores) * Math.max(0.5, sensitivity);
  const markers = scores
    .map((score, index) => ({ score, index: index + 1 }))
    .filter((item) => item.score >= threshold)
    .map((item) => ({
      bucket: String(points[item.index]?.bucket ?? ''),
      score: item.score,
      value: Number(points[item.index]?.overall ?? 0),
    }))
    .filter((item) => item.bucket !== '');

  return { markers, threshold };
}

function solve3x3(matrix: number[][], vector: number[]): [number, number, number] {
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let bestRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(a[row]?.[pivot] ?? 0) > Math.abs(a[bestRow]?.[pivot] ?? 0)) {
        bestRow = row;
      }
    }

    if (bestRow !== pivot) {
      const tempRow = a[pivot];
      a[pivot] = a[bestRow] ?? [0, 0, 0];
      a[bestRow] = tempRow ?? [0, 0, 0];

      const tempValue = b[pivot];
      b[pivot] = b[bestRow] ?? 0;
      b[bestRow] = tempValue ?? 0;
    }

    const pivotValue = a[pivot]?.[pivot] ?? 0;
    if (Math.abs(pivotValue) < 1e-9) {
      return [0, 0, 0];
    }

    for (let col = pivot; col < 3; col += 1) {
      a[pivot][col] = (a[pivot]?.[col] ?? 0) / pivotValue;
    }
    b[pivot] = (b[pivot] ?? 0) / pivotValue;

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) {
        continue;
      }
      const factor = a[row]?.[pivot] ?? 0;
      for (let col = pivot; col < 3; col += 1) {
        a[row][col] = (a[row]?.[col] ?? 0) - factor * (a[pivot]?.[col] ?? 0);
      }
      b[row] = (b[row] ?? 0) - factor * (b[pivot] ?? 0);
    }
  }

  return [(b[0] ?? 0), (b[1] ?? 0), (b[2] ?? 0)];
}

function fitQuadratic(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  if (values.length < 3) {
    return fitLinearRegression(values).predicted;
  }

  const n = values.length;
  let sumX = 0;
  let sumX2 = 0;
  let sumX3 = 0;
  let sumX4 = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2Y = 0;

  for (let index = 0; index < n; index += 1) {
    const x = index;
    const y = values[index] ?? 0;
    const x2 = x * x;
    sumX += x;
    sumX2 += x2;
    sumX3 += x2 * x;
    sumX4 += x2 * x2;
    sumY += y;
    sumXY += x * y;
    sumX2Y += x2 * y;
  }

  const [a, b, c] = solve3x3(
    [
      [n, sumX, sumX2],
      [sumX, sumX2, sumX3],
      [sumX2, sumX3, sumX4],
    ],
    [sumY, sumXY, sumX2Y],
  );

  return values.map((_, index) => a + b * index + c * index * index);
}

function computeTrendSeries(
  points: TemporalPoint[],
  decompositionSeries: TemporalPoint[],
  deseasonalize: boolean,
): { series: TemporalPoint[]; diagnostics: TrendDiagnostics } {
  if (points.length === 0) {
    return {
      series: [],
      diagnostics: { linearSlope: 0, linearIntercept: 0, linearR2: 0, trendDirection: 'Stable' },
    };
  }

  const values = points.map((point, index) => {
    if (!deseasonalize) {
      return Number(point.overall ?? 0);
    }
    return Number(point.overall ?? 0) - Number(decompositionSeries[index]?.seasonal ?? 0);
  });

  const linear = fitLinearRegression(values);
  const quadratic = fitQuadratic(values);
  const direction: TrendDiagnostics['trendDirection'] =
    linear.slope > 0.001 ? 'Rising' : linear.slope < -0.001 ? 'Falling' : 'Stable';

  return {
    series: points.map((point, index) => ({
      bucket: String(point.bucket),
      overall: values[index] ?? 0,
      linear: linear.predicted[index] ?? 0,
      quadratic: quadratic[index] ?? 0,
    })),
    diagnostics: {
      linearSlope: linear.slope,
      linearIntercept: linear.intercept,
      linearR2: linear.r2,
      trendDirection: direction,
    },
  };
}

function getIsoWeekNumber(date: Date): number {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function computeProfileSeries(
  rows: AnalyticsDataRow[],
  mode: ProfileMode,
  aggregationMode: AggregationMode,
): TemporalPoint[] {
  const grouped = new Map<string, number[]>();

  for (const row of rows) {
    const date = new Date(row.observed_at);
    let key = '';
    if (mode === 'hour') {
      key = `${date.getUTCHours()}`.padStart(2, '0');
    } else if (mode === 'weekday') {
      const weekday = date.getUTCDay();
      key = WEEKDAY_LABELS[(weekday + 6) % 7] ?? 'N/A';
    } else if (mode === 'month') {
      key = MONTH_LABELS[date.getUTCMonth()] ?? 'N/A';
    } else if (mode === 'quarter') {
      key = `Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    } else {
      key = `${date.getUTCFullYear()}`;
    }

    const values = grouped.get(key) ?? [];
    values.push(row.value);
    grouped.set(key, values);
  }

  const weekdayOrder = new Map(WEEKDAY_LABELS.map((label, index) => [label, index]));
  const monthOrder = new Map(MONTH_LABELS.map((label, index) => [label, index]));

  return Array.from(grouped.entries())
    .map(([bucket, values]) => ({
      bucket,
      overall: aggregateValues(values, aggregationMode),
    }))
    .sort((left, right) => {
      if (mode === 'hour') {
        return Number(left.bucket) - Number(right.bucket);
      }
      if (mode === 'weekday') {
        return (weekdayOrder.get(String(left.bucket)) ?? 0) - (weekdayOrder.get(String(right.bucket)) ?? 0);
      }
      if (mode === 'month') {
        return (monthOrder.get(String(left.bucket)) ?? 0) - (monthOrder.get(String(right.bucket)) ?? 0);
      }
      if (mode === 'quarter') {
        return String(left.bucket).localeCompare(String(right.bucket));
      }
      return Number(left.bucket) - Number(right.bucket);
    });
}

function computeProfileHeatmap(
  rows: AnalyticsDataRow[],
  mode: HeatmapProfileMode,
  aggregationMode: AggregationMode,
): ProfileHeatmap {
  const grouped = new Map<string, number[]>();
  const xLabelSet = new Set<string>();
  const yLabelSet = new Set<string>();

  for (const row of rows) {
    const date = new Date(row.observed_at);
    const year = `${date.getUTCFullYear()}`;
    let xLabel = '';
    if (mode === 'month') {
      xLabel = MONTH_LABELS[date.getUTCMonth()] ?? 'N/A';
    } else if (mode === 'hour') {
      xLabel = `${date.getUTCHours()}`.padStart(2, '0');
    } else if (mode === 'weekday') {
      const weekday = date.getUTCDay();
      xLabel = WEEKDAY_LABELS[(weekday + 6) % 7] ?? 'N/A';
    } else {
      xLabel = `${getIsoWeekNumber(date)}`.padStart(2, '0');
    }

    const key = `${year}|${xLabel}`;
    const values = grouped.get(key) ?? [];
    values.push(row.value);
    grouped.set(key, values);
    xLabelSet.add(xLabel);
    yLabelSet.add(year);
  }

  const xLabels = Array.from(xLabelSet.values()).sort((left, right) => {
    if (mode === 'month') {
      return MONTH_LABELS.indexOf(left) - MONTH_LABELS.indexOf(right);
    }
    if (mode === 'weekday') {
      return WEEKDAY_LABELS.indexOf(left) - WEEKDAY_LABELS.indexOf(right);
    }
    return Number(left) - Number(right);
  });
  const yLabels = Array.from(yLabelSet.values()).sort((left, right) => Number(left) - Number(right));
  const values = new Map<string, number>();

  for (const yLabel of yLabels) {
    for (const xLabel of xLabels) {
      const key = `${yLabel}|${xLabel}`;
      const sample = grouped.get(key);
      if (sample && sample.length > 0) {
        values.set(key, aggregateValues(sample, aggregationMode));
      }
    }
  }

  return { xLabels, yLabels, values };
}

function computeCorrelationMatrix(rows: AnalyticsDataRow[], granularity: TimeGranularity): CorrelationMatrixResult {
  const bucketsByVariable = new Map<string, Map<string, number[]>>();
  for (const row of rows) {
    const variable = row.variable_code;
    const bucket = getBucketKey(row.observed_at, granularity);
    const variableMap = bucketsByVariable.get(variable) ?? new Map<string, number[]>();
    const values = variableMap.get(bucket) ?? [];
    values.push(row.value);
    variableMap.set(bucket, values);
    bucketsByVariable.set(variable, variableMap);
  }

  const variables = Array.from(bucketsByVariable.keys()).sort();
  const averagedByVariable = new Map<string, Map<string, number>>();
  for (const variable of variables) {
    const variableBuckets = bucketsByVariable.get(variable) ?? new Map<string, number[]>();
    const averaged = new Map<string, number>();
    for (const [bucket, values] of variableBuckets.entries()) {
      averaged.set(bucket, safeMean(values));
    }
    averagedByVariable.set(variable, averaged);
  }

  const cells: CorrelationCell[] = [];
  for (const leftVariable of variables) {
    for (const rightVariable of variables) {
      const leftSeries = averagedByVariable.get(leftVariable) ?? new Map<string, number>();
      const rightSeries = averagedByVariable.get(rightVariable) ?? new Map<string, number>();
      const sharedBuckets = Array.from(leftSeries.keys()).filter((bucket) => rightSeries.has(bucket));

      const leftValues = sharedBuckets.map((bucket) => leftSeries.get(bucket) ?? 0);
      const rightValues = sharedBuckets.map((bucket) => rightSeries.get(bucket) ?? 0);

      const leftMean = safeMean(leftValues);
      const rightMean = safeMean(rightValues);
      const leftStd = safeStd(leftValues);
      const rightStd = safeStd(rightValues);

      let correlation = 0;
      if (sharedBuckets.length >= 2 && leftStd > 1e-9 && rightStd > 1e-9) {
        const covariance = leftValues.reduce(
          (accumulator, leftValue, index) =>
            accumulator + (leftValue - leftMean) * ((rightValues[index] ?? 0) - rightMean),
          0,
        ) / sharedBuckets.length;
        correlation = covariance / (leftStd * rightStd);
      } else if (leftVariable === rightVariable) {
        correlation = 1;
      }

      cells.push({ x: leftVariable, y: rightVariable, value: Math.max(-1, Math.min(1, correlation)) });
    }
  }

  return { variables, cells };
}

function computeVariablePairPoints(
  rows: AnalyticsDataRow[],
  granularity: TimeGranularity,
  leftVariable: string | null,
  rightVariable: string | null,
): VariablePairPoint[] {
  if (!leftVariable || !rightVariable || leftVariable === rightVariable) {
    return [];
  }

  const bucketMap = new Map<string, { left: number[]; right: number[] }>();
  for (const row of rows) {
    if (row.variable_code !== leftVariable && row.variable_code !== rightVariable) {
      continue;
    }
    const bucket = getBucketKey(row.observed_at, granularity);
    const item = bucketMap.get(bucket) ?? { left: [], right: [] };
    if (row.variable_code === leftVariable) {
      item.left.push(row.value);
    } else {
      item.right.push(row.value);
    }
    bucketMap.set(bucket, item);
  }

  return Array.from(bucketMap.entries())
    .filter(([, item]) => item.left.length > 0 && item.right.length > 0)
    .map(([bucket, item]) => ({
      bucket,
      x: safeMean(item.left),
      y: safeMean(item.right),
    }));
}

function computePearsonCorrelation(points: VariablePairPoint[]): number {
  if (points.length < 2) {
    return 0;
  }
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xMean = safeMean(xValues);
  const yMean = safeMean(yValues);
  const xStd = safeStd(xValues);
  const yStd = safeStd(yValues);
  if (xStd <= 1e-9 || yStd <= 1e-9) {
    return 0;
  }

  const covariance =
    points.reduce((accumulator, point) => accumulator + (point.x - xMean) * (point.y - yMean), 0) / points.length;
  return covariance / (xStd * yStd);
}

function intensityColor(value: number, min: number, max: number): string {
  if (max <= min) {
    return 'hsl(205, 80%, 88%)';
  }
  const ratio = (value - min) / (max - min);
  const lightness = 92 - ratio * 38;
  return `hsl(205, 72%, ${lightness}%)`;
}

function correlationColor(value: number): string {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped >= 0) {
    const saturation = 24 + clamped * 58;
    const lightness = 94 - clamped * 40;
    return `hsl(148, ${saturation}%, ${lightness}%)`;
  }
  const magnitude = Math.abs(clamped);
  const saturation = 24 + magnitude * 58;
  const lightness = 94 - magnitude * 40;
  return `hsl(4, ${saturation}%, ${lightness}%)`;
}

export function AnalyticalWorkspace() {
  const [filters, setFilters] = useState<AnalyticsFilterOptionsResponse | null>(null);
  const [rows, setRows] = useState<AnalyticsDataRow[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [selectedVariables, setSelectedVariables] = useState<string[]>([]);
  const [chartType, setChartType] = useState<ChartType>('line');
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangePreset, setRangePreset] = useState<string>('all');
  const [sourceSearch, setSourceSearch] = useState('');
  const [rowLimit, setRowLimit] = useState(5000);
  const [exploreRange, setExploreRange] = useState<[number, number]>([0, 100]);
  const [heatmapWindowDays, setHeatmapWindowDays] = useState(14);
  const [heatmapOffset, setHeatmapOffset] = useState(0);
  const [labSection, setLabSection] = useState<LabSection>('load-data');
  const [rollingWindow, setRollingWindow] = useState(14);
  const [seasonalityMode, setSeasonalityMode] = useState<'weekday' | 'month' | 'hour'>('weekday');
  const [decompositionWindow, setDecompositionWindow] = useState(21);
  const [profileMode, setProfileMode] = useState<ProfileMode>('hour');
  const [profileAggregation, setProfileAggregation] = useState<AggregationMode>('mean');
  const [profileHeatmapMode, setProfileHeatmapMode] = useState<HeatmapProfileMode>('month');
  const [forecastHorizon, setForecastHorizon] = useState(30);
  const [changepointWindow, setChangepointWindow] = useState(7);
  const [changepointSensitivity, setChangepointSensitivity] = useState(2);
  const [trendDeseasonalized, setTrendDeseasonalized] = useState(false);
  const [pairVariableX, setPairVariableX] = useState<string>('');
  const [pairVariableY, setPairVariableY] = useState<string>('');
  const [bootstrapReady, setBootstrapReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const filteredSources = useMemo(() => {
    if (!filters) {
      return [];
    }

    const keyword = sourceSearch.trim().toLowerCase();
    if (!keyword) {
      return filters.sources;
    }

    return filters.sources.filter((source) => {
      const haystack = `${source.name} ${source.source_type} ${source.etl_run_id}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [filters, sourceSearch]);

  const selectedSources = useMemo(() => {
    if (!filters || selectedSourceIds.length === 0) {
      return [];
    }
    const selectedSet = new Set(selectedSourceIds);
    return filters.sources.filter((source) => selectedSet.has(source.id));
  }, [filters, selectedSourceIds]);
  const availableVariables = useMemo(() => {
    if (!filters) {
      return [];
    }
    if (selectedSources.length === 0) {
      return filters.variables;
    }
    const allowedCodes = new Set(selectedSources.flatMap((source) => source.variable_codes));
    return filters.variables.filter((variable) => allowedCodes.has(variable.code));
  }, [filters, selectedSources]);
  const availableVariableCodes = useMemo(
    () => availableVariables.map((variable) => variable.code),
    [availableVariables],
  );
  const sourceMaxRows = useMemo(
    () =>
      Math.max(
        100,
        selectedSources.reduce((total, source) => total + source.row_count, 0) || 5000,
      ),
    [selectedSources],
  );

  const splitLineByStation = selectedVariables.length <= 1 && selectedStations.length > 1;
  const temporalSeries = useMemo(
    () => computeTemporalSeries(rows, granularity, splitLineByStation),
    [rows, granularity, splitLineByStation],
  );
  const stationBars = useMemo(() => computeStationBars(rows), [rows]);
  const scatterByStation = useMemo(() => computeScatterByStation(rows), [rows]);
  const histogram = useMemo(() => computeHistogram(rows), [rows]);
  const heatmap = useMemo(() => computeHeatmap(rows), [rows]);
  const summary = useMemo(() => buildSummary(rows, temporalSeries.points), [rows, temporalSeries.points]);
  const variableSummary = useMemo(() => {
    const grouped = new Map<string, number[]>();
    const labels = new Map<string, string>();

    for (const row of rows) {
      const code = row.variable_code;
      const bucket = grouped.get(code) ?? [];
      bucket.push(row.value);
      grouped.set(code, bucket);
      labels.set(code, row.variable_name || row.variable_code);
    }

    return Array.from(grouped.entries()).map(([code, values]) => {
      const ordered = [...values].sort((left, right) => left - right);
      return {
        code,
        label: labels.get(code) ?? code,
        count: values.length,
        mean: safeMean(values),
        std: safeStd(values),
        min: ordered[0] ?? 0,
        median: ordered[Math.floor(ordered.length / 2)] ?? 0,
        max: ordered[ordered.length - 1] ?? 0,
      };
    });
  }, [rows]);
  const rollingSeries = useMemo(
    () => computeRollingStats(temporalSeries.points, rollingWindow),
    [temporalSeries.points, rollingWindow],
  );
  const seasonalitySeries = useMemo(
    () => computeSeasonalProfile(rows, seasonalityMode, profileAggregation),
    [rows, seasonalityMode, profileAggregation],
  );
  const autocorrSeries = useMemo(() => computeAutocorrelation(temporalSeries.points, 30), [temporalSeries.points]);
  const anomalySeries = useMemo(() => computeAnomalySeries(temporalSeries.points), [temporalSeries.points]);
  const decompositionSeries = useMemo(
    () => computeDecompositionSeries(temporalSeries.points, granularity, decompositionWindow),
    [temporalSeries.points, granularity, decompositionWindow],
  );
  const pacfSeries = useMemo(() => computePartialAutocorrelation(temporalSeries.points, 30), [temporalSeries.points]);
  const profileSeries = useMemo(
    () => computeProfileSeries(rows, profileMode, profileAggregation),
    [rows, profileMode, profileAggregation],
  );
  const profileHeatmap = useMemo(
    () => computeProfileHeatmap(rows, profileHeatmapMode, profileAggregation),
    [rows, profileHeatmapMode, profileAggregation],
  );
  const forecastSeries = useMemo(
    () => computeForecastSeries(temporalSeries.points, granularity, forecastHorizon, decompositionSeries),
    [temporalSeries.points, granularity, forecastHorizon, decompositionSeries],
  );
  const changepointResult = useMemo(
    () => detectChangepoints(temporalSeries.points, changepointWindow, changepointSensitivity),
    [temporalSeries.points, changepointWindow, changepointSensitivity],
  );
  const trendResult = useMemo(
    () => computeTrendSeries(temporalSeries.points, decompositionSeries, trendDeseasonalized),
    [temporalSeries.points, decompositionSeries, trendDeseasonalized],
  );
  const correlationMatrix = useMemo(
    () => computeCorrelationMatrix(rows, granularity),
    [rows, granularity],
  );
  const pairPoints = useMemo(
    () => computeVariablePairPoints(rows, granularity, pairVariableX || null, pairVariableY || null),
    [rows, granularity, pairVariableX, pairVariableY],
  );
  const pairCorrelation = useMemo(() => computePearsonCorrelation(pairPoints), [pairPoints]);
  const exploredDateRange = useMemo(
    () => applyExploreRange(dateFrom, dateTo, exploreRange),
    [dateFrom, dateTo, exploreRange],
  );
  const heatmapView = useMemo(() => {
    const totalDays = heatmap.days.length;
    const clampedWindow = Math.max(7, Math.min(60, heatmapWindowDays));
    const maxOffset = Math.max(0, totalDays - clampedWindow);
    const safeOffset = Math.min(heatmapOffset, maxOffset);
    const startIndex = Math.max(0, totalDays - clampedWindow - safeOffset);
    const endIndex = totalDays - safeOffset;

    return {
      days: heatmap.days.slice(startIndex, endIndex),
      maxOffset,
      safeOffset,
      totalDays,
    };
  }, [heatmap.days, heatmapOffset, heatmapWindowDays]);

  const runAnalysis = useCallback(
    async ({
      sourceIds,
      stationCodes,
      variableCodes,
      fromDate,
      toDate,
      requestedLimit,
      rangePercent,
    }: {
      sourceIds: number[];
      stationCodes: string[];
      variableCodes: string[];
      fromDate: string;
      toDate: string;
      requestedLimit: number;
      rangePercent: [number, number];
    }) => {
      if (sourceIds.length === 0) {
        setRows([]);
        setError('Select at least one source file to visualize data.');
        return;
      }

      const selectedSet = new Set(sourceIds);
      const datasetMaxRows = Math.max(
        100,
        filters?.sources
          .filter((source) => selectedSet.has(source.id))
          .reduce((total, source) => total + source.row_count, 0) ?? requestedLimit,
      );
      const effectiveLimit = Math.max(100, Math.min(requestedLimit, datasetMaxRows));
      const exploredRange = applyExploreRange(fromDate, toDate, rangePercent);
      const normalizedRange = normalizeDateRange(exploredRange.from, exploredRange.to);
      const payload: AnalyticsQueryRequest = {
        source_file_ids: sourceIds,
        station_codes: stationCodes.length > 0 ? stationCodes : undefined,
        variable_codes: variableCodes.length > 0 ? variableCodes : undefined,
        date_from: normalizedRange.from,
        date_to: normalizedRange.to,
        limit: effectiveLimit,
      };

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      setLoading(true);
      setError(null);
      try {
        const response = await runAnalyticsQuery(payload);
        if (requestId !== requestIdRef.current) {
          return;
        }

        setRows(response.rows);
        if (response.rows.length === 0) {
          setError('No data for the selected source selection and filters.');
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setRows([]);
        setError(err instanceof Error ? err.message : 'Failed to load analytics data.');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        const nextFilters = await getAnalyticsFilters();
        setFilters(nextFilters);

        const firstSource = nextFilters.sources[0] ?? null;
        const from = toIsoDate(nextFilters.min_observed_at);
        const to = toIsoDate(nextFilters.max_observed_at);

        setDateFrom(from);
        setDateTo(to);
        setSelectedSourceIds(firstSource ? [firstSource.id] : []);
        const initialVariables =
          firstSource && firstSource.variable_codes.length > 0
            ? firstSource.variable_codes.slice(0, 2)
            : nextFilters.variables.slice(0, 2).map((item) => item.code);
        setSelectedVariables(initialVariables);
        setPairVariableX(initialVariables[0] ?? nextFilters.variables[0]?.code ?? '');
        setPairVariableY(initialVariables[1] ?? initialVariables[0] ?? nextFilters.variables[1]?.code ?? '');
        setRowLimit(Math.max(100, Math.min(5000, firstSource?.row_count ?? 5000)));
        setExploreRange([0, 100]);
        setRangePreset('all');
        setBootstrapReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load analytics filters.');
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }

    const timeout = setTimeout(() => {
      void runAnalysis({
        sourceIds: selectedSourceIds,
        stationCodes: selectedStations,
        variableCodes: selectedVariables,
        fromDate: dateFrom,
        toDate: dateTo,
        requestedLimit: rowLimit,
        rangePercent: exploreRange,
      });
    }, 130);

    return () => clearTimeout(timeout);
  }, [
    bootstrapReady,
    selectedSourceIds,
    selectedStations,
    selectedVariables,
    dateFrom,
    dateTo,
    rowLimit,
    exploreRange,
    runAnalysis,
  ]);

  useEffect(() => {
    setRowLimit((current) => Math.min(Math.max(100, current), sourceMaxRows));
  }, [sourceMaxRows]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    setSelectedVariables((current) => {
      const next = current.filter((code) => availableVariableCodes.includes(code));
      const fallback = availableVariableCodes.slice(0, Math.min(2, availableVariableCodes.length));
      const target = next.length > 0 ? next : fallback;
      if (target.length === current.length && target.every((code, index) => code === current[index])) {
        return current;
      }
      return target;
    });
  }, [availableVariableCodes, bootstrapReady]);

  useEffect(() => {
    setHeatmapOffset((current) => Math.min(current, heatmapView.maxOffset));
  }, [heatmapView.maxOffset]);

  useEffect(() => {
    const availableVariables = correlationMatrix.variables;
    if (availableVariables.length === 0) {
      return;
    }

    if (!availableVariables.includes(pairVariableX)) {
      setPairVariableX(availableVariables[0] ?? '');
    }
    if (!availableVariables.includes(pairVariableY) || pairVariableY === pairVariableX) {
      const fallback = availableVariables.find((value) => value !== (availableVariables[0] ?? '')) ?? availableVariables[0] ?? '';
      if (pairVariableY !== fallback) {
        setPairVariableY(fallback);
      }
    }
  }, [correlationMatrix.variables, pairVariableX, pairVariableY]);

  const applyRangePreset = (presetId: string) => {
    if (!filters) {
      return;
    }

    const minDate = toIsoDate(filters.min_observed_at);
    const maxDate = toIsoDate(filters.max_observed_at);
    if (!maxDate) {
      return;
    }

    const preset = RANGE_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    if (preset.days === null) {
      setDateFrom(minDate);
      setDateTo(maxDate);
      setExploreRange([0, 100]);
      setRangePreset(presetId);
      return;
    }

    const from = addDays(maxDate, -(preset.days - 1));
    const boundedFrom = minDate && from < minDate ? minDate : from;
    setDateFrom(boundedFrom);
    setDateTo(maxDate);
    setExploreRange([0, 100]);
    setRangePreset(presetId);
  };

  const handleRunClick = () => {
    void runAnalysis({
      sourceIds: selectedSourceIds,
      stationCodes: selectedStations,
      variableCodes: selectedVariables,
      fromDate: dateFrom,
      toDate: dateTo,
      requestedLimit: rowLimit,
      rangePercent: exploreRange,
    });
  };

  const handleToggleStation = (stationCode: string) => {
    setSelectedStations((current) => {
      if (current.includes(stationCode)) {
        return current.filter((item) => item !== stationCode);
      }
      return [...current, stationCode];
    });
  };

  const handleToggleVariable = (variableCode: string) => {
    setSelectedVariables((current) => {
      if (current.includes(variableCode)) {
        return current.filter((item) => item !== variableCode);
      }
      return [...current, variableCode];
    });
  };
  const handleToggleSource = (sourceId: number) => {
    setSelectedSourceIds((current) => {
      if (current.includes(sourceId)) {
        return current.filter((item) => item !== sourceId);
      }
      return [...current, sourceId];
    });
  };

  const heatValues = Array.from(heatmap.values.values());
  const heatMin = heatValues.length > 0 ? Math.min(...heatValues) : 0;
  const heatMax = heatValues.length > 0 ? Math.max(...heatValues) : 1;
  const profileHeatValues = Array.from(profileHeatmap.values.values());
  const profileHeatMin = profileHeatValues.length > 0 ? Math.min(...profileHeatValues) : 0;
  const profileHeatMax = profileHeatValues.length > 0 ? Math.max(...profileHeatValues) : 1;
  const correlationByCell = useMemo(
    () =>
      new Map(
        correlationMatrix.cells.map((cell) => [`${cell.y}|${cell.x}`, cell.value]),
      ),
    [correlationMatrix.cells],
  );

  const scatterEntries = Object.entries(scatterByStation);
  const activeSection = ANALYSIS_SECTIONS.find((section) => section.value === labSection) ?? ANALYSIS_SECTIONS[0];
  const ActiveSectionIcon = activeSection.icon;
  const selectedVariableLabels = selectedVariables.map(
    (code) => availableVariables.find((variable) => variable.code === code)?.name ?? code,
  );
  const summaryChartData = variableSummary.map((item) => ({
    variable: item.label,
    mean: round(item.mean),
    max: round(item.max),
  }));
  const renderGranularityControl = (label = 'Time Detail') => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <ToggleGroup
        type="single"
        value={granularity}
        onValueChange={(value) => value && setGranularity(value as TimeGranularity)}
        variant="outline"
        className="w-full grid grid-cols-4"
      >
        {GRANULARITY_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.id} value={option.id} className="h-8 text-[10px]">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  const renderSectionControls = () => {
    if (labSection === 'rolling') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr_auto] gap-3 items-end mb-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Chart Type</Label>
            <ToggleGroup
              type="single"
              value={chartType}
              onValueChange={(value) => value && setChartType(value as ChartType)}
              variant="outline"
              className="w-full grid grid-cols-2 xl:grid-cols-4"
            >
              {CHART_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <ToggleGroupItem key={option.id} value={option.id} className="h-9 gap-1.5 text-[11px]">
                    <Icon className="w-3.5 h-3.5" />
                    {option.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
          {renderGranularityControl()}
          <div className="flex items-center gap-2">
            <Label htmlFor="rolling-window" className="text-xs text-muted-foreground">
              Rolling window
            </Label>
            <Input
              id="rolling-window"
              type="number"
              min={2}
              max={90}
              value={rollingWindow}
              onChange={(event) => setRollingWindow(Math.max(2, Math.min(90, Number(event.target.value || 14))))}
              className="h-8 w-24"
            />
          </div>
        </div>
      );
    }
    if (labSection === 'anomaly') {
      return <div className="mb-4">{renderGranularityControl()}</div>;
    }
    if (labSection === 'seasonality') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
          <Select value={seasonalityMode} onValueChange={(value) => setSeasonalityMode(value as 'weekday' | 'month' | 'hour')}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Calendar profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekday">Weekday</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="hour">Hour</SelectItem>
            </SelectContent>
          </Select>
          <Select value={profileAggregation} onValueChange={(value) => setProfileAggregation(value as AggregationMode)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Aggregation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mean">Mean</SelectItem>
              <SelectItem value="median">Median</SelectItem>
              <SelectItem value="sum">Sum</SelectItem>
              <SelectItem value="min">Min</SelectItem>
              <SelectItem value="max">Max</SelectItem>
              <SelectItem value="std">Std</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }
    if (labSection === 'profiles') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
          <Select value={profileMode} onValueChange={(value) => setProfileMode(value as ProfileMode)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Profile by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">Hour of day</SelectItem>
              <SelectItem value="weekday">Day of week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="quarter">Quarter</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
          <Select value={profileAggregation} onValueChange={(value) => setProfileAggregation(value as AggregationMode)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Aggregation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mean">Mean</SelectItem>
              <SelectItem value="median">Median</SelectItem>
              <SelectItem value="sum">Sum</SelectItem>
              <SelectItem value="min">Min</SelectItem>
              <SelectItem value="max">Max</SelectItem>
              <SelectItem value="std">Std</SelectItem>
            </SelectContent>
          </Select>
          <Select value={profileHeatmapMode} onValueChange={(value) => setProfileHeatmapMode(value as HeatmapProfileMode)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Heatmap profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Year x month</SelectItem>
              <SelectItem value="hour">Year x hour</SelectItem>
              <SelectItem value="weekday">Year x weekday</SelectItem>
              <SelectItem value="week">Year x week</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }
    if (labSection === 'decomposition') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-end mb-4">
          {renderGranularityControl()}
          <div className="flex items-center gap-2">
            <Label htmlFor="decomposition-window" className="text-xs text-muted-foreground">
              Trend window
            </Label>
            <Input
              id="decomposition-window"
              type="number"
              min={2}
              max={90}
              value={decompositionWindow}
              onChange={(event) => setDecompositionWindow(Math.max(2, Math.min(90, Number(event.target.value || 21))))}
              className="h-8 w-24"
            />
          </div>
        </div>
      );
    }
    if (labSection === 'autocorr' || labSection === 'pacf') {
      return <div className="mb-4">{renderGranularityControl()}</div>;
    }
    if (labSection === 'forecast') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-end mb-4">
          {renderGranularityControl()}
          <div className="flex items-center gap-2">
            <Label htmlFor="forecast-horizon" className="text-xs text-muted-foreground">
              Forecast horizon
            </Label>
            <Input
              id="forecast-horizon"
              type="number"
              min={1}
              max={365}
              value={forecastHorizon}
              onChange={(event) => setForecastHorizon(Math.max(1, Math.min(365, Number(event.target.value || 30))))}
              className="h-8 w-24"
            />
          </div>
        </div>
      );
    }
    if (labSection === 'changepoints') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_auto] gap-3 items-end mb-4">
          {renderGranularityControl()}
          <div className="flex items-center gap-2">
            <Label htmlFor="changepoint-window" className="text-xs text-muted-foreground">
              Smoothing
            </Label>
            <Input
              id="changepoint-window"
              type="number"
              min={2}
              max={30}
              value={changepointWindow}
              onChange={(event) => setChangepointWindow(Math.max(2, Math.min(30, Number(event.target.value || 7))))}
              className="h-8 w-20"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="changepoint-sensitivity" className="text-xs text-muted-foreground">
              Sensitivity
            </Label>
            <Input
              id="changepoint-sensitivity"
              type="number"
              min={0.5}
              max={6}
              step={0.1}
              value={changepointSensitivity}
              onChange={(event) =>
                setChangepointSensitivity(Math.max(0.5, Math.min(6, Number(event.target.value || 2))))
              }
              className="h-8 w-20"
            />
          </div>
        </div>
      );
    }
    if (labSection === 'trend') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-end mb-4">
          {renderGranularityControl()}
          <div>
            <button
              type="button"
              onClick={() => setTrendDeseasonalized((current) => !current)}
              className={`text-xs rounded-md border px-2 py-1.5 transition-colors ${
                trendDeseasonalized
                  ? 'bg-[#509EE3] text-white border-[#509EE3]'
                  : 'bg-white text-foreground border-gray-300'
              }`}
            >
              {trendDeseasonalized ? 'Deseasonalized: on' : 'Deseasonalized: off'}
            </button>
          </div>
        </div>
      );
    }
    if (labSection === 'correlation') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-2 mb-4">
          {renderGranularityControl('Bucketing')}
          <Select value={pairVariableX} onValueChange={setPairVariableX}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Variable X" />
            </SelectTrigger>
            <SelectContent>
              {correlationMatrix.variables.map((variable) => (
                <SelectItem key={`pair-x-${variable}`} value={variable}>
                  {variable}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pairVariableY} onValueChange={setPairVariableY}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Variable Y" />
            </SelectTrigger>
            <SelectContent>
              {correlationMatrix.variables.map((variable) => (
                <SelectItem key={`pair-y-${variable}`} value={variable}>
                  {variable}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    return null;
  };

  const renderTimeSeriesChart = () => {
    if (rows.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          Pick a loaded source selection to render charts.
        </div>
      );
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={temporalSeries.points} margin={{ top: 8, right: 20, left: 10, bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Legend />
            {temporalSeries.keys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth={2.6}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stationBars} margin={{ top: 8, right: 16, left: 10, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="station" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="avg" radius={[6, 6, 0, 0]}>
              {stationBars.map((item, index) => (
                <Cell key={`station-bar-${item.station}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'scatter') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              type="number"
              dataKey="hour"
              name="Hour"
              label={{ value: 'Hour of Day (UTC)', position: 'insideBottom', offset: -5 }}
            />
            <YAxis
              type="number"
              dataKey="value"
              name="Value"
              label={{ value: 'Measured Value', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip cursor={{ strokeDasharray: '4 4' }} />
            <Legend />
            {scatterEntries.map(([stationCode, points], index) => (
              <Scatter
                key={stationCode}
                name={stationCode}
                data={points}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    return (
      <div className="h-full overflow-auto border rounded-md p-3 bg-[#f8fbff]">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="heatmap-window" className="text-xs text-muted-foreground">
              Window (days)
            </Label>
            <Input
              id="heatmap-window"
              type="number"
              min={7}
              max={60}
              value={heatmapWindowDays}
              onChange={(event) =>
                setHeatmapWindowDays(Math.max(7, Math.min(60, Number(event.target.value || 14))))
              }
              className="h-7 w-20"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setHeatmapOffset((current) => Math.min(heatmapView.maxOffset, current + heatmapWindowDays))
              }
              disabled={heatmapView.safeOffset >= heatmapView.maxOffset}
            >
              Older
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHeatmapOffset((current) => Math.max(0, current - heatmapWindowDays))}
              disabled={heatmapView.safeOffset <= 0}
            >
              Newer
            </Button>
          </div>
        </div>
        <div className="min-w-[780px]">
          <div className="grid grid-cols-[84px_repeat(24,minmax(26px,1fr))] gap-1">
            <div />
            {heatmap.hours.map((hour) => (
              <div key={`hour-${hour}`} className="text-[10px] text-center text-muted-foreground">
                {hour}
              </div>
            ))}
            {heatmapView.days.map((day) => (
              <Fragment key={`heat-row-${day}`}>
                <div className="text-[10px] text-muted-foreground pr-1">{day.slice(5)}</div>
                {heatmap.hours.map((hour) => {
                  const key = `${day}|${hour}`;
                  const value = heatmap.values.get(key);
                  return (
                    <div
                      key={key}
                      title={value !== undefined ? `${day} ${hour}:00 - ${round(value)}` : `${day} ${hour}:00`}
                      className="h-5 rounded-sm"
                      style={{
                        background:
                          value === undefined
                            ? 'hsl(210, 30%, 95%)'
                            : intensityColor(value, heatMin, heatMax),
                      }}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = () => {
    if (rows.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          Load data from the source section before opening this analysis.
        </div>
      );
    }
    if (labSection === 'rolling') {
      return renderTimeSeriesChart();
    }
    if (labSection === 'anomaly') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={anomalySeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
            <Line type="monotone" dataKey="upper" name="Upper IQR" stroke="#94A3B8" dot={false} />
            <Line type="monotone" dataKey="lower" name="Lower IQR" stroke="#94A3B8" dot={false} />
            <Line
              type="monotone"
              dataKey="anomaly_value"
              name="Anomaly"
              stroke="#DC2626"
              dot={{ r: 3, fill: '#DC2626' }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'profiles') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={profileSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="overall" name={profileAggregation.toUpperCase()} fill="#509EE3" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'seasonality') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={seasonalitySeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="overall" name={profileAggregation.toUpperCase()} fill="#509EE3" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'decomposition') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={decompositionSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
            <Line type="monotone" dataKey="trend" name="Trend" stroke="#509EE3" dot={false} />
            <Line type="monotone" dataKey="seasonal" name="Seasonal" stroke="#0B7285" dot={false} />
            <Line type="monotone" dataKey="residual" name="Residual" stroke="#A16207" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'autocorr') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={autocorrSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis domain={[-1, 1]} />
            <Tooltip />
            <ReferenceLine y={0} stroke="#64748B" />
            <Bar dataKey="overall" name="Autocorrelation" fill="#1F5A8A" />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'pacf') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pacfSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis domain={[-1, 1]} />
            <Tooltip />
            <ReferenceLine y={0} stroke="#64748B" />
            <Bar dataKey="overall" name="Partial Autocorrelation" fill="#0B7285" />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'forecast') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={forecastSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="observed" name="Observed" stroke="#1F5A8A" dot={false} />
            <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#509EE3" dot={false} />
            <Line type="monotone" dataKey="upper" name="Upper band" stroke="#94A3B8" dot={false} />
            <Line type="monotone" dataKey="lower" name="Lower band" stroke="#94A3B8" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'changepoints') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={temporalSeries.points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
            {changepointResult.markers.slice(0, 40).map((marker) => (
              <ReferenceLine key={`cp-${marker.bucket}`} x={marker.bucket} stroke="#DC2626" strokeDasharray="4 4" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'trend') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendResult.series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="bucket" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
            <Line type="monotone" dataKey="linear" name="Linear trend" stroke="#509EE3" dot={false} />
            <Line type="monotone" dataKey="quadratic" name="Quadratic trend" stroke="#0B7285" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if (labSection === 'correlation') {
      return (
        <div className="h-full overflow-auto border rounded-md p-3 bg-[#f8fbff]">
          {correlationMatrix.variables.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Correlation requires at least one variable with rows.
            </div>
          ) : (
            <div className="min-w-[460px]">
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `110px repeat(${correlationMatrix.variables.length}, minmax(56px, 1fr))`,
                }}
              >
                <div />
                {correlationMatrix.variables.map((column) => (
                  <div key={`corr-col-${column}`} className="text-[10px] text-center text-muted-foreground">
                    {column}
                  </div>
                ))}
                {correlationMatrix.variables.map((rowVariable) => (
                  <Fragment key={`corr-row-${rowVariable}`}>
                    <div className="text-[10px] text-muted-foreground pr-1">{rowVariable}</div>
                    {correlationMatrix.variables.map((columnVariable) => {
                      const value = correlationByCell.get(`${rowVariable}|${columnVariable}`) ?? 0;
                      return (
                        <div
                          key={`corr-cell-${rowVariable}-${columnVariable}`}
                          title={`${rowVariable} vs ${columnVariable}: ${round(value, 3)}`}
                          className="h-8 rounded-sm border border-white/50 flex items-center justify-center text-[10px]"
                          style={{ background: correlationColor(value) }}
                        >
                          {round(value, 2)}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (labSection === 'summary') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={summaryChartData} margin={{ top: 8, right: 16, left: 10, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="variable" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={56} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="mean" fill="#509EE3" name="Mean" radius={[4, 4, 0, 0]} />
            <Bar dataKey="max" fill="#EF4444" name="Max" radius={[4, 4, 0, 0]} opacity={0.6} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return null;
  };

  const renderSecondaryContent = () => {
    if (labSection === 'rolling') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader>
              <CardTitle className="text-lg">Distribution Snapshot</CardTitle>
              <CardDescription>Histogram of the currently loaded values.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogram} margin={{ top: 8, right: 8, left: 8, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="range" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(histogram.length / 6))} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Count" fill="#509EE3" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader>
              <CardTitle className="text-lg">Rolling Envelope</CardTitle>
              <CardDescription>Observed values against the rolling baseline for the last {rollingWindow} buckets.</CardDescription>
            </CardHeader>
            <CardContent>
              {rollingSeries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rolling window series available.</p>
              ) : (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rollingSeries} margin={{ top: 8, right: 12, left: 4, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
                      <Line type="monotone" dataKey="mean" name="Rolling mean" stroke="#509EE3" dot={false} />
                      <Line type="monotone" dataKey="upper" name="Upper band" stroke="#94A3B8" dot={false} />
                      <Line type="monotone" dataKey="lower" name="Lower band" stroke="#94A3B8" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    if (labSection === 'summary') {
      return (
        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Statistical Summary</CardTitle>
            <CardDescription>Descriptive statistics for the filtered variables.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F9FBFC]">
                    <th className="border border-gray-200 p-2 text-left font-medium">Variable</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Count</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Mean</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Std</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Min</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Median</th>
                    <th className="border border-gray-200 p-2 text-right font-medium">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {variableSummary.map((item) => (
                    <tr key={item.code} className="hover:bg-[#F9FBFC]">
                      <td className="border border-gray-200 p-2 font-medium">{item.label}</td>
                      <td className="border border-gray-200 p-2 text-right">{item.count}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(item.mean)}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(item.std)}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(item.min)}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(item.median)}</td>
                      <td className="border border-gray-200 p-2 text-right">{round(item.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (labSection === 'profiles') {
      return (
        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Profile Heatmap</CardTitle>
            <CardDescription>{profileHeatmapMode} aggregation matrix</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border rounded-md p-3 bg-[#f8fbff]">
              <div className="min-w-[620px]">
                <div
                  className="grid gap-1"
                  style={{
                    gridTemplateColumns: `96px repeat(${profileHeatmap.xLabels.length}, minmax(28px, 1fr))`,
                  }}
                >
                  <div />
                  {profileHeatmap.xLabels.map((xLabel) => (
                    <div key={`profile-col-${xLabel}`} className="text-[10px] text-center text-muted-foreground">
                      {xLabel}
                    </div>
                  ))}
                  {profileHeatmap.yLabels.map((yLabel) => (
                    <Fragment key={`profile-row-${yLabel}`}>
                      <div className="text-[10px] text-muted-foreground pr-1">{yLabel}</div>
                      {profileHeatmap.xLabels.map((xLabel) => {
                        const key = `${yLabel}|${xLabel}`;
                        const value = profileHeatmap.values.get(key);
                        return (
                          <div
                            key={`profile-cell-${key}`}
                            title={value !== undefined ? `${yLabel} ${xLabel}: ${round(value)}` : `${yLabel} ${xLabel}`}
                            className="h-6 rounded-sm"
                            style={{
                              background:
                                value === undefined
                                  ? 'hsl(210, 30%, 95%)'
                                  : intensityColor(value, profileHeatMin, profileHeatMax),
                            }}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (labSection === 'correlation') {
      return (
        <Card className="bg-white border-[#dce5f1]">
          <CardHeader>
            <CardTitle className="text-lg">Pair Comparison</CardTitle>
            <CardDescription>
              Pearson correlation between {pairVariableX || 'X'} and {pairVariableY || 'Y'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-[#f8fbff] px-3 py-2 text-xs">
              Pair correlation: <span className="font-semibold">{round(pairCorrelation, 4)}</span>
            </div>
            <div className="h-[280px] w-full">
              {pairPoints.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-[#f8fbff]">
                  Not enough shared points to render variable pair comparison.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={pairVariableX}
                      label={{ value: pairVariableX, position: 'insideBottom', offset: -4 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={pairVariableY}
                      label={{ value: pairVariableY, angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip cursor={{ strokeDasharray: '4 4' }} />
                    <Scatter data={pairPoints} fill="#509EE3" />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      );
    }

    if (labSection === 'trend') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard label="Slope" value={round(trendResult.diagnostics.linearSlope, 6).toString()} icon={TrendingUp} />
          <KpiCard label="R2" value={round(trendResult.diagnostics.linearR2, 4).toString()} icon={BarChart3} />
          <KpiCard
            label="Direction"
            value={trendResult.diagnostics.trendDirection}
            icon={LineChartIcon}
            badgeTone={
              trendResult.diagnostics.trendDirection === 'Rising'
                ? 'green'
                : trendResult.diagnostics.trendDirection === 'Falling'
                ? 'amber'
                : 'blue'
            }
          />
        </div>
      );
    }

    if (labSection === 'changepoints') {
      return (
        <div className="rounded-md border bg-[#f8fbff] px-3 py-2 text-xs text-muted-foreground">
          Threshold: {round(changepointResult.threshold, 4)} · Detected changepoints: {changepointResult.markers.length}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-full flex bg-[#F9FBFC]">
      <aside className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="border-b border-gray-200 px-4 py-4">
          <h2 className="font-semibold text-foreground mb-1">Analysis Section</h2>
          <p className="text-xs text-muted-foreground">Select analysis type and keep charts in focus</p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {ANALYSIS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = labSection === section.value;
              const locked = section.value !== 'load-data' && selectedSourceIds.length === 0;

              return (
                <button
                  key={section.value}
                  type="button"
                  onClick={() => setLabSection(section.value)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    isActive ? 'bg-[#509EE3] text-white shadow-md' : 'hover:bg-gray-100 text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" style={{ color: isActive ? 'white' : section.color }} />
                  <span className="flex-1 text-left">{section.label}</span>
                  {locked && <div className="w-2 h-2 rounded-full bg-orange-400" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {labSection !== 'load-data' && (
          <div className="border-t border-gray-200 p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Variables</Label>
              <div className="flex flex-wrap gap-1.5 rounded-md border bg-[#f8fbff] p-2 max-h-[136px] overflow-auto">
                {availableVariables.map((variable) => {
                  const active = selectedVariables.includes(variable.code);
                  return (
                    <button
                      key={variable.code}
                      type="button"
                      onClick={() => handleToggleVariable(variable.code)}
                      className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                        active
                          ? 'border-[#509EE3] bg-[#509EE3] text-white'
                          : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                      }`}
                    >
                      {variable.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Current Selection</Label>
              <div className="rounded-lg border bg-[#F9FBFC] p-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Sources</span>
                  <span className="font-medium text-foreground">{selectedSourceIds.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Stations</span>
                  <span className="font-medium text-foreground">{selectedStations.length || 'All'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Rows</span>
                  <span className="font-medium text-foreground">{rows.length.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setLabSection('load-data')}>
              <Database className="w-3 h-3 mr-1.5" />
              Adjust Data Selection
            </Button>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-foreground mb-1">Analytical Workspace</h1>
              <p className="text-muted-foreground">Comprehensive time series analysis for atmospheric data.</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className="bg-[#e9f3fd] text-[#1F5A8A] border border-[#509EE3]/30">
                {selectedSourceIds.length > 0 ? `${selectedSourceIds.length} sources selected` : 'No sources selected'}
              </Badge>
              <Badge variant="outline">{selectedVariableLabels.join(', ') || 'Select variables'}</Badge>
            </div>
          </div>

          {error && (
            <Card className="bg-white border-l-4 border-l-[#509EE3]">
              <CardContent className="py-3">
                <p className="text-sm text-[#1F5A8A]">{error}</p>
              </CardContent>
            </Card>
          )}

          {labSection === 'load-data' ? (
            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Upload className="w-5 h-5 text-[#509EE3]" />
                  Load Data
                </CardTitle>
                <CardDescription>
                  Select one or more source files and configure the analysis window before rendering charts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.9fr_0.9fr] gap-4">
                  <div className="rounded-xl border bg-[#fbfdff] p-4">
                    <Label className="text-xs text-muted-foreground">Source Files</Label>
                    <div className="relative mt-2">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={sourceSearch}
                        onChange={(event) => setSourceSearch(event.target.value)}
                        placeholder="Search loaded file..."
                        className="pl-9"
                      />
                    </div>
                    <ScrollArea className="mt-3 h-[360px]">
                      <div className="space-y-2 pr-3">
                        {filteredSources.map((source) => {
                          const active = selectedSourceIds.includes(source.id);
                          return (
                            <button
                              key={source.id}
                              type="button"
                              onClick={() => handleToggleSource(source.id)}
                              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                active
                                  ? 'border-[#509EE3] bg-[#e9f3fd]'
                                  : 'border-gray-200 bg-white hover:border-[#509EE3]/35'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#509EE3]/10">
                                  <FileSpreadsheet className="w-4 h-4 text-[#509EE3]" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{source.name}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {source.source_type} · {source.row_count.toLocaleString()} rows
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {filteredSources.length === 0 && (
                          <p className="text-xs text-muted-foreground py-6 text-center">No matching loaded files.</p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
                      <Label className="text-xs text-muted-foreground">Date Range</Label>
                      <div className="relative">
                        <Input
                          type="date"
                          value={dateFrom}
                          onChange={(event) => {
                            setDateFrom(event.target.value);
                            setExploreRange([0, 100]);
                            setRangePreset('custom');
                          }}
                          className="pr-8"
                        />
                        <Calendar className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      <div className="relative">
                        <Input
                          type="date"
                          value={dateTo}
                          onChange={(event) => {
                            setDateTo(event.target.value);
                            setExploreRange([0, 100]);
                            setRangePreset('custom');
                          }}
                          className="pr-8"
                        />
                        <Calendar className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {RANGE_PRESETS.map((preset) => {
                          const active = rangePreset === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => applyRangePreset(preset.id)}
                              className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                                active
                                  ? 'border-[#509EE3] bg-[#509EE3] text-white'
                                  : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Stations</Label>
                        <Badge variant="outline">{selectedStations.length || 'All'}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-[184px] overflow-auto">
                        {(filters?.stations ?? []).map((station) => {
                          const active = selectedStations.includes(station.code);
                          return (
                            <button
                              key={station.code}
                              type="button"
                              onClick={() => handleToggleStation(station.code)}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] border transition-colors ${
                                active
                                  ? 'border-[#509EE3] bg-[#509EE3] text-white'
                                  : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                              }`}
                              title={station.name}
                            >
                              <MapPin className="w-3.5 h-3.5" />
                              {station.code}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Variables</Label>
                        <Badge variant="outline">{selectedVariables.length || 0}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-[210px] overflow-auto">
                        {availableVariables.map((variable) => {
                          const active = selectedVariables.includes(variable.code);
                          return (
                            <button
                              key={variable.code}
                              type="button"
                              onClick={() => handleToggleVariable(variable.code)}
                              className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                                active
                                  ? 'border-[#509EE3] bg-[#509EE3] text-white'
                                  : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                              }`}
                            >
                              {variable.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="row-limit" className="text-xs text-muted-foreground">
                          Rows to load
                        </Label>
                        <Input
                          id="row-limit"
                          type="number"
                          min={100}
                          max={sourceMaxRows}
                          step={100}
                          value={rowLimit}
                          onChange={(event) =>
                            setRowLimit(Math.min(sourceMaxRows, Math.max(100, Number(event.target.value || 100))))
                          }
                        />
                      </div>
                      <Button className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" onClick={handleRunClick} disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                        Load Analysis Data
                      </Button>
                      <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Selection</span>
                          <span className="font-medium text-foreground">{selectedSourceIds.length} files</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Dataset cap</span>
                          <span className="font-medium text-foreground">{sourceMaxRows.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Time window</span>
                          <span className="font-medium text-foreground">{dateFrom || '--'} to {dateTo || '--'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Sources" value={selectedSources.length.toString()} icon={Database} />
                <KpiCard label="Samples" value={summary.samples.toLocaleString()} icon={Table2} />
                <KpiCard label="Mean" value={round(summary.mean).toString()} icon={TrendingUp} />
                <KpiCard
                  label="Trend"
                  value={summary.trend}
                  icon={LineChartIcon}
                  badgeTone={summary.trend === 'Rising' ? 'green' : summary.trend === 'Falling' ? 'amber' : 'blue'}
                />
              </div>

              <Card className="bg-white border-[#dce5f1]">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ActiveSectionIcon className="w-5 h-5" style={{ color: activeSection.color }} />
                    {activeSection.label}
                  </CardTitle>
                  <CardDescription>
                    {labSection === 'rolling' && 'Visualize temporal behavior with line, bar, scatter or heatmap views.'}
                    {labSection === 'anomaly' && 'Detect abnormal behavior using rolling spread and anomaly markers.'}
                    {labSection === 'profiles' && 'Inspect recurring hourly, weekly or seasonal profiles.'}
                    {labSection === 'summary' && 'Review descriptive statistics for the current data selection.'}
                    {labSection === 'seasonality' && 'Compare calendar patterns across the selected date range.'}
                    {labSection === 'decomposition' && 'Separate trend, seasonal and residual components.'}
                    {labSection === 'autocorr' && 'Inspect lag dependency structure over time.'}
                    {labSection === 'pacf' && 'Inspect partial lag dependency structure.'}
                    {labSection === 'forecast' && 'Project near-future values using the current series behavior.'}
                    {labSection === 'changepoints' && 'Highlight abrupt changes in slope and local structure.'}
                    {labSection === 'trend' && 'Compare observed data against linear and quadratic trend lines.'}
                    {labSection === 'correlation' && 'Compare variables through correlation heatmaps and pair plots.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {renderSectionControls()}
                  <div className="mb-4 rounded-md border border-gray-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                      <span>
                        Explore window: {exploredDateRange.from || '--'} to {exploredDateRange.to || '--'}
                      </span>
                      <span>
                        {Math.round(exploreRange[0])}% - {Math.round(exploreRange[1])}%
                      </span>
                    </div>
                    <Slider
                      value={exploreRange}
                      min={0}
                      max={100}
                      step={1}
                      minStepsBetweenThumbs={2}
                      onValueChange={(value) => {
                        if (value.length === 2) {
                          setExploreRange([value[0] ?? 0, value[1] ?? 100]);
                        }
                      }}
                      className="mt-2 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-slate-200 [&_[data-slot=slider-range]]:bg-slate-400 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-slate-500 [&_[data-slot=slider-thumb]]:bg-white"
                    />
                  </div>
                  <div className="h-[560px] w-full">{renderAnalysisChart()}</div>
                </CardContent>
              </Card>

              {renderSecondaryContent()}
            </div>
          )}
        </div>
    </main>
  </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  badgeTone,
  small = false,
}: {
  label: string;
  value: string;
  icon: typeof Database;
  badgeTone?: 'green' | 'amber' | 'blue';
  small?: boolean;
}) {
  const tone =
    badgeTone === 'green'
      ? 'bg-green-100 text-green-700 border-green-200'
      : badgeTone === 'amber'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-[#509EE3]/10 text-[#1F5A8A] border-[#509EE3]/20';

  return (
    <Card className="bg-white border-[#dce5f1]">
      <CardContent className="py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="w-4 h-4 text-[#509EE3]" />
        </div>
        {badgeTone ? (
          <Badge className={`mt-2 ${tone}`}>{value}</Badge>
        ) : (
          <p className={`mt-2 font-semibold text-foreground ${small ? 'text-sm truncate' : 'text-xl'}`}>{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
