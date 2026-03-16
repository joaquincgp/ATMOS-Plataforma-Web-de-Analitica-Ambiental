import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Calendar,
  ChevronRight,
  Clock3,
  Database,
  FileSpreadsheet,
  LineChart as LineChartIcon,
  Loader2,
  MapPin,
  Orbit,
  Play,
  Search,
  Table2,
  TrendingUp,
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
  getStationLiveSnapshot,
  runAnalyticsQuery,
  runSqlPreview,
  type AnalyticsDataRow,
  type AnalyticsFilterOptionsResponse,
  type AnalyticsQueryRequest,
  type SqlPreviewResponse,
  type StationLiveSnapshotResponse,
} from '@/api/modules/analytics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  | 'correlation';

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

const LAB_SECTION_OPTIONS: { value: LabSection; label: string }[] = [
  { value: 'rolling', label: 'Time Series Visualization' },
  { value: 'decomposition', label: 'Decomposition' },
  { value: 'autocorr', label: 'ACF' },
  { value: 'pacf', label: 'PACF' },
  { value: 'anomaly', label: 'Anomaly Detection' },
  { value: 'profiles', label: 'Temporal Profiles' },
  { value: 'seasonality', label: 'Calendar Heatmap' },
  { value: 'forecast', label: 'Forecasting' },
  { value: 'changepoints', label: 'Changepoint Analysis' },
  { value: 'trend', label: 'Trend Analysis' },
  { value: 'correlation', label: 'Correlation Matrix' },
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

const SQL_SOURCE_TABLES: { value: string; label: string; sql: string }[] = [
  { value: 'measurements', label: 'measurements', sql: 'SELECT * FROM measurements ORDER BY observed_at DESC' },
  { value: 'stations', label: 'stations', sql: 'SELECT * FROM stations ORDER BY code ASC' },
  { value: 'variables', label: 'variables', sql: 'SELECT * FROM variables ORDER BY code ASC' },
  { value: 'source_files', label: 'source_files', sql: 'SELECT * FROM source_files ORDER BY downloaded_at DESC' },
  { value: 'etl_runs', label: 'etl_runs', sql: 'SELECT * FROM etl_runs ORDER BY started_at DESC' },
];

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
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
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
  const [labSection, setLabSection] = useState<LabSection>('rolling');
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

  const [liveSnapshot, setLiveSnapshot] = useState<StationLiveSnapshotResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const [selectedSqlTable, setSelectedSqlTable] = useState('');
  const [sqlLimit, setSqlLimit] = useState(120);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlPreview, setSqlPreview] = useState<SqlPreviewResponse | null>(null);

  const requestIdRef = useRef(0);
  const liveRequestIdRef = useRef(0);

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

  const selectedSource = useMemo(() => {
    if (!filters || selectedSourceId === null) {
      return null;
    }
    return filters.sources.find((source) => source.id === selectedSourceId) ?? null;
  }, [filters, selectedSourceId]);
  const sourceMaxRows = useMemo(
    () => Math.max(100, selectedSource?.row_count ?? 5000),
    [selectedSource],
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
  const sampleRows = useMemo(() => rows.slice(0, 180), [rows]);
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
  const selectedSqlSource = useMemo(
    () => SQL_SOURCE_TABLES.find((item) => item.value === selectedSqlTable) ?? null,
    [selectedSqlTable],
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
      sourceId,
      stationCodes,
      variableCodes,
      fromDate,
      toDate,
      requestedLimit,
      rangePercent,
    }: {
      sourceId: number | null;
      stationCodes: string[];
      variableCodes: string[];
      fromDate: string;
      toDate: string;
      requestedLimit: number;
      rangePercent: [number, number];
    }) => {
      if (sourceId === null) {
        setRows([]);
        setError('Select a source file to visualize data.');
        return;
      }

      const sourceForLimit = filters?.sources.find((source) => source.id === sourceId);
      const datasetMaxRows = Math.max(100, sourceForLimit?.row_count ?? requestedLimit);
      const effectiveLimit = Math.max(100, Math.min(requestedLimit, datasetMaxRows));
      const exploredRange = applyExploreRange(fromDate, toDate, rangePercent);
      const normalizedRange = normalizeDateRange(exploredRange.from, exploredRange.to);
      const payload: AnalyticsQueryRequest = {
        source_file_ids: [sourceId],
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
          setError('No data for the selected source and filters.');
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

  const refreshLiveSnapshot = useCallback(async (stationCodes: string[]) => {
    const requestId = liveRequestIdRef.current + 1;
    liveRequestIdRef.current = requestId;

    setLiveLoading(true);
    try {
      const response = await getStationLiveSnapshot(stationCodes);
      if (requestId !== liveRequestIdRef.current) {
        return;
      }
      setLiveSnapshot(response);
    } catch {
      if (requestId !== liveRequestIdRef.current) {
        return;
      }
      setLiveSnapshot(null);
    } finally {
      if (requestId === liveRequestIdRef.current) {
        setLiveLoading(false);
      }
    }
  }, []);

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
        setSelectedSourceId(firstSource?.id ?? null);
        setSelectedVariables(nextFilters.variables.slice(0, 2).map((item) => item.code));
        setPairVariableX(nextFilters.variables[0]?.code ?? '');
        setPairVariableY(nextFilters.variables[1]?.code ?? nextFilters.variables[0]?.code ?? '');
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
        sourceId: selectedSourceId,
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
    selectedSourceId,
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
    setHeatmapOffset((current) => Math.min(current, heatmapView.maxOffset));
  }, [heatmapView.maxOffset]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    void refreshLiveSnapshot(selectedStations);
  }, [bootstrapReady, selectedStations, refreshLiveSnapshot]);

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
      sourceId: selectedSourceId,
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

  const handleRunSqlPreview = async () => {
    if (!selectedSqlSource) {
      setSqlError('Select a source table.');
      setSqlPreview(null);
      return;
    }

    setSqlLoading(true);
    setSqlError(null);
    try {
      const response = await runSqlPreview({ sql: selectedSqlSource.sql, limit: sqlLimit });
      setSqlPreview(response);
      if (response.truncated) {
        setSqlError(`SQL preview truncated to ${response.row_count} rows.`);
      }
    } catch (err) {
      setSqlPreview(null);
      setSqlError(err instanceof Error ? err.message : 'SQL preview failed.');
    } finally {
      setSqlLoading(false);
    }
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

  return (
    <div className="h-full overflow-y-auto bg-[linear-gradient(180deg,#f7fafc_0%,#f2f6fb_100%)]">
      <div className="px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">Analytical Workspace</h1>
          <p className="text-muted-foreground">Explore atmospheric datasets with temporal detail levels and station-aware charts.</p>
        </div>

        <Card className="bg-white border-[#dce5f1]">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Data Logic</CardTitle>
            <CardDescription>
              Select loaded file, define time range and detail level, filter stations and render chart instantly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
              <div className="xl:col-span-5 space-y-2">
                <Label>Source File Name</Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={sourceSearch}
                      onChange={(event) => setSourceSearch(event.target.value)}
                      placeholder="Search loaded file..."
                      className="pl-9"
                    />
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
                </div>
                <div className="max-h-32 overflow-y-auto rounded-md border bg-[#f8fbff] p-1.5 space-y-1">
                  {filteredSources.map((source) => {
                    const active = selectedSourceId === source.id;
                    return (
                      <button
                        key={source.id}
                        type="button"
                        onClick={() => setSelectedSourceId(source.id)}
                        className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                          active
                            ? 'border-[#509EE3] bg-[#e9f3fd]'
                            : 'border-transparent bg-white hover:border-[#509EE3]/35'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-[#509EE3]" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{source.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {source.source_type} · {source.row_count.toLocaleString()} rows
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {filteredSources.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1 py-2">No matching loaded files.</p>
                  )}
                </div>
              </div>

              <div className="xl:col-span-3 space-y-2">
                <Label htmlFor="date-from">Date Window</Label>
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      id="date-from"
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
                      id="date-to"
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

              <div className="xl:col-span-4 space-y-2">
                <Label>Chart Type</Label>
                <ToggleGroup
                  type="single"
                  value={chartType}
                  onValueChange={(value) => {
                    if (value) {
                      setChartType(value as ChartType);
                    }
                  }}
                  variant="outline"
                  className="w-full grid grid-cols-2"
                >
                  {CHART_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <ToggleGroupItem key={option.id} value={option.id} className="h-11 gap-2 text-xs">
                        <Icon className="w-4 h-4" />
                        {option.label}
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>

                <Label className="flex items-center gap-1.5">
                  <Clock3 className="w-3.5 h-3.5" />
                  Time Detail Level
                </Label>
                <ToggleGroup
                  type="single"
                  value={granularity}
                  onValueChange={(value) => {
                    if (value) {
                      setGranularity(value as TimeGranularity);
                    }
                  }}
                  variant="outline"
                  className="w-full grid grid-cols-4"
                >
                  {GRANULARITY_OPTIONS.map((option) => (
                    <ToggleGroupItem key={option.id} value={option.id} className="h-9 text-xs">
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <Label>Stations</Label>
                <div className="flex flex-wrap gap-1.5 rounded-md border bg-[#f8fbff] p-2 max-h-[96px] overflow-auto">
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

                <Label>Variables</Label>
                <div className="flex flex-wrap gap-1.5 rounded-md border bg-[#f8fbff] p-2 max-h-[96px] overflow-auto">
                  {(filters?.variables ?? []).map((variable) => {
                    const active = selectedVariables.includes(variable.code);
                    return (
                      <button
                        key={variable.code}
                        type="button"
                        onClick={() => handleToggleVariable(variable.code)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] border transition-colors ${
                          active
                            ? 'border-[#509EE3] bg-[#509EE3] text-white'
                            : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                        }`}
                        title={variable.name}
                      >
                        {variable.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
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
                    setRowLimit(
                      Math.min(
                        sourceMaxRows,
                        Math.max(100, Number(event.target.value || 100)),
                      ),
                    )
                  }
                  className="h-8 w-32"
                />
              </div>
              <Badge className="bg-[#e9f3fd] text-[#1F5A8A] border border-[#509EE3]/30">
                Max for dataset: {sourceMaxRows.toLocaleString()}
              </Badge>
              <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" onClick={handleRunClick} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-9 space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiCard label="Source" value={selectedSource?.name ?? '--'} icon={Database} small />
              <KpiCard label="Samples" value={summary.samples.toLocaleString()} icon={Table2} />
              <KpiCard label="Mean" value={round(summary.mean).toString()} icon={TrendingUp} />
              <KpiCard label="Min / Max" value={`${round(summary.min)} / ${round(summary.max)}`} icon={BarChart3} />
              <KpiCard
                label="Trend"
                value={summary.trend}
                icon={LineChartIcon}
                badgeTone={summary.trend === 'Rising' ? 'green' : summary.trend === 'Falling' ? 'amber' : 'blue'}
              />
            </div>

            {error && (
              <Card className="bg-white border-l-4 border-l-[#509EE3]">
                <CardContent className="py-3">
                  <p className="text-sm text-[#1F5A8A]">{error}</p>
                </CardContent>
              </Card>
            )}

            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">Visualization Preview</CardTitle>
                <CardDescription>
                  {chartType === 'line' &&
                    (selectedVariables.length > 1
                      ? 'Color-coded lines by variable for multivariable comparison'
                      : splitLineByStation
                      ? 'Color-coded lines by station for multi-station comparison'
                      : `Temporal trends grouped by ${granularity}`)}
                  {chartType === 'bar' && 'Average concentration by station'}
                  {chartType === 'scatter' && 'Hourly dispersion with station-based colors'}
                  {chartType === 'heatmap' && 'Day-hour intensity matrix'}
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                <div className="h-[520px] w-full">
                  {rows.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      Pick a loaded file with rows to render charts.
                    </div>
                  ) : chartType === 'line' ? (
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
                  ) : chartType === 'bar' ? (
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
                  ) : chartType === 'scatter' ? (
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
                  ) : (
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
                              setHeatmapWindowDays(
                                Math.max(7, Math.min(60, Number(event.target.value || 14))),
                              )
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
                              setHeatmapOffset((current) =>
                                Math.min(heatmapView.maxOffset, current + heatmapWindowDays),
                              )
                            }
                            disabled={heatmapView.safeOffset >= heatmapView.maxOffset}
                          >
                            Older
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setHeatmapOffset((current) =>
                                Math.max(0, current - heatmapWindowDays),
                              )
                            }
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
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">Distribution Snapshot</CardTitle>
                <CardDescription>Histogram of measured values using all filtered records.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  {histogram.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      No values available for histogram.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={histogram} margin={{ top: 8, right: 16, left: 10, bottom: 18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="range" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#1F5A8A" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">Advanced Time-Series Lab</CardTitle>
                <CardDescription>
                  Decomposition, autocorrelation, forecasting, changepoints, trends and multivariable profiles.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="analysis-section">Analysis Section</Label>
                  <Select
                    value={labSection}
                    onValueChange={(value) => {
                      setLabSection(value as LabSection);
                    }}
                  >
                    <SelectTrigger id="analysis-section">
                      <SelectValue placeholder="Select section..." />
                    </SelectTrigger>
                    <SelectContent>
                      {LAB_SECTION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {labSection === 'rolling' && (
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
                      onChange={(event) =>
                        setRollingWindow(Math.max(2, Math.min(90, Number(event.target.value || 14))))
                      }
                      className="h-8 w-24"
                    />
                  </div>
                )}

                {labSection === 'seasonality' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Select
                      value={seasonalityMode}
                      onValueChange={(value) => setSeasonalityMode(value as 'weekday' | 'month' | 'hour')}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Calendar profile" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekday">Weekday</SelectItem>
                        <SelectItem value="month">Month</SelectItem>
                        <SelectItem value="hour">Hour</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={profileAggregation}
                      onValueChange={(value) => setProfileAggregation(value as AggregationMode)}
                    >
                      <SelectTrigger className="h-8 text-xs">
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
                )}

                {labSection === 'decomposition' && (
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
                      onChange={(event) =>
                        setDecompositionWindow(Math.max(2, Math.min(90, Number(event.target.value || 21))))
                      }
                      className="h-8 w-24"
                    />
                  </div>
                )}

                {labSection === 'profiles' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Select value={profileMode} onValueChange={(value) => setProfileMode(value as ProfileMode)}>
                      <SelectTrigger className="h-8 text-xs">
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
                    <Select
                      value={profileAggregation}
                      onValueChange={(value) => setProfileAggregation(value as AggregationMode)}
                    >
                      <SelectTrigger className="h-8 text-xs">
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
                    <Select
                      value={profileHeatmapMode}
                      onValueChange={(value) => setProfileHeatmapMode(value as HeatmapProfileMode)}
                    >
                      <SelectTrigger className="h-8 text-xs">
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
                )}

                {labSection === 'forecast' && (
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
                      onChange={(event) =>
                        setForecastHorizon(Math.max(1, Math.min(365, Number(event.target.value || 30))))
                      }
                      className="h-8 w-24"
                    />
                  </div>
                )}

                {labSection === 'changepoints' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label htmlFor="changepoint-window" className="text-xs text-muted-foreground">
                      Smoothing window
                    </Label>
                    <Input
                      id="changepoint-window"
                      type="number"
                      min={2}
                      max={30}
                      value={changepointWindow}
                      onChange={(event) =>
                        setChangepointWindow(Math.max(2, Math.min(30, Number(event.target.value || 7))))
                      }
                      className="h-8 w-20"
                    />
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
                        setChangepointSensitivity(
                          Math.max(0.5, Math.min(6, Number(event.target.value || 2))),
                        )
                      }
                      className="h-8 w-20"
                    />
                  </div>
                )}

                {labSection === 'trend' && (
                  <div className="flex items-center gap-3">
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
                )}

                {labSection === 'correlation' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Select value={pairVariableX} onValueChange={setPairVariableX}>
                      <SelectTrigger className="h-8 text-xs">
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
                      <SelectTrigger className="h-8 text-xs">
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
                )}

                <div className="h-[340px] w-full">
                  {labSection === 'rolling' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={rollingSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="bucket" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
                        <Line type="monotone" dataKey="mean" name="Rolling Mean" stroke="#509EE3" dot={false} />
                        <Line type="monotone" dataKey="upper" name="Upper Band" stroke="#94A3B8" dot={false} />
                        <Line type="monotone" dataKey="lower" name="Lower Band" stroke="#94A3B8" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : labSection === 'seasonality' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={seasonalitySeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="bucket" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="overall" name={profileAggregation.toUpperCase()} fill="#509EE3" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : labSection === 'autocorr' ? (
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
                  ) : labSection === 'pacf' ? (
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
                  ) : labSection === 'decomposition' ? (
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
                  ) : labSection === 'profiles' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={profileSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="bucket" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="overall" name={profileAggregation.toUpperCase()} fill="#509EE3" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : labSection === 'forecast' ? (
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
                  ) : labSection === 'changepoints' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={temporalSeries.points}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="bucket" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="overall" name="Observed" stroke="#1F5A8A" dot={false} />
                        {changepointResult.markers.slice(0, 40).map((marker) => (
                          <ReferenceLine
                            key={`cp-${marker.bucket}`}
                            x={marker.bucket}
                            stroke="#DC2626"
                            strokeDasharray="4 4"
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : labSection === 'trend' ? (
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
                  ) : labSection === 'correlation' ? (
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
                  ) : (
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
                  )}
                </div>

                {labSection === 'profiles' && (
                  <div className="overflow-auto border rounded-md p-3 bg-[#f8fbff]">
                    <div className="text-xs text-muted-foreground mb-2">
                      Profile heatmap ({profileHeatmapMode}) using {profileAggregation.toUpperCase()} aggregation
                    </div>
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
                )}

                {labSection === 'changepoints' && (
                  <div className="rounded-md border bg-[#f8fbff] px-3 py-2 text-xs text-muted-foreground">
                    Threshold: {round(changepointResult.threshold, 4)} · Detected changepoints:{' '}
                    {changepointResult.markers.length}
                  </div>
                )}

                {labSection === 'trend' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                      Slope: <span className="font-semibold">{round(trendResult.diagnostics.linearSlope, 6)}</span>
                    </div>
                    <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                      R2: <span className="font-semibold">{round(trendResult.diagnostics.linearR2, 4)}</span>
                    </div>
                    <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                      Direction: <span className="font-semibold">{trendResult.diagnostics.trendDirection}</span>
                    </div>
                  </div>
                )}

                {labSection === 'correlation' && (
                  <div className="space-y-2">
                    <div className="rounded-md border bg-[#f8fbff] px-3 py-2 text-xs">
                      Pair correlation ({pairVariableX} vs {pairVariableY}):{' '}
                      <span className="font-semibold">{round(pairCorrelation, 4)}</span>
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
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">Data Sample</CardTitle>
                <CardDescription>Quick sample to understand data nature.</CardDescription>
              </CardHeader>
              <CardContent>
                {sampleRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sample rows available.</p>
                ) : (
                  <div className="max-h-[300px] overflow-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[#f8fbff] border-b">
                        <tr>
                          <th className="px-3 py-2 text-left">Observed At</th>
                          <th className="px-3 py-2 text-left">Station</th>
                          <th className="px-3 py-2 text-left">Variable</th>
                          <th className="px-3 py-2 text-left">Value</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleRows.map((row, index) => (
                          <tr key={`${row.observed_at}-${row.station_code}-${index}`} className="border-b last:border-0">
                            <td className="px-3 py-2 whitespace-nowrap">{new Date(row.observed_at).toLocaleString()}</td>
                            <td className="px-3 py-2">{row.station_code}</td>
                            <td className="px-3 py-2">{row.variable_code}</td>
                            <td className="px-3 py-2">{round(row.value)}</td>
                            <td className="px-3 py-2">{row.unit ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:col-span-3 space-y-6">
            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">Station Live Snapshot</CardTitle>
                <CardDescription>Latest value per variable by station (simulated real-time).</CardDescription>
              </CardHeader>
              <CardContent>
                {liveLoading ? (
                  <div className="py-6 flex items-center justify-center text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading latest station data...
                  </div>
                ) : !liveSnapshot || liveSnapshot.stations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No latest station records available.</p>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                    {liveSnapshot.stations.map((station) => (
                      <div key={station.station_code} className="border rounded-md p-2.5 bg-[#f8fbff]">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{station.station_name}</p>
                            <p className="text-[11px] text-muted-foreground">{station.station_code}</p>
                          </div>
                          <Badge className="bg-[#e9f3fd] text-[#1F5A8A] border border-[#509EE3]/25">{station.region ?? 'Region N/A'}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {station.latitude ?? '--'}, {station.longitude ?? '--'}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Last update: {new Date(station.latest_observed_at).toLocaleString()}
                        </p>
                        <div className="mt-2 space-y-1">
                          {station.variables.map((item) => (
                            <div key={`${station.station_code}-${item.variable_code}`} className="flex items-center justify-between text-[11px]">
                              <span className="font-medium text-foreground">{item.variable_code}</span>
                              <span className="text-muted-foreground">
                                {round(item.value)} {item.unit ?? ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-[#dce5f1]">
              <CardHeader>
                <CardTitle className="text-lg">SQL Quick Preview</CardTitle>
                <CardDescription>Select source table for read-only sample query.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="source-table-select">Source Table</Label>
                  <Select
                    value={selectedSqlTable}
                    onValueChange={(value) => {
                      setSelectedSqlTable(value);
                      setSqlPreview(null);
                      setSqlError(null);
                    }}
                  >
                    <SelectTrigger id="source-table-select">
                      <SelectValue placeholder="Select table..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SQL_SOURCE_TABLES.map((table) => (
                        <SelectItem key={table.value} value={table.value}>
                          {table.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border bg-[#f8fbff] px-3 py-2">
                  <p className="text-[11px] text-muted-foreground mb-1">Generated query (read-only)</p>
                  <code className="text-xs">
                    {selectedSqlSource?.sql ?? '--'}
                  </code>
                </div>

                <div className="flex items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="sql-limit">Limit</Label>
                    <Input
                      id="sql-limit"
                      type="number"
                      min={1}
                      max={500}
                      value={sqlLimit}
                      onChange={(event) =>
                        setSqlLimit(Math.min(500, Math.max(1, Number(event.target.value || 1))))
                      }
                      className="w-24"
                    />
                  </div>
                  <Button
                    type="button"
                    className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                    onClick={() => void handleRunSqlPreview()}
                    disabled={sqlLoading}
                  >
                    {sqlLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Table2 className="w-4 h-4 mr-2" />}
                    Preview
                  </Button>
                </div>

                {sqlError && <p className="text-sm text-[#1F5A8A]">{sqlError}</p>}

                {sqlPreview && sqlPreview.columns.length > 0 && (
                  <div className="max-h-[280px] overflow-auto border rounded-md">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#f8fbff] border-b">
                        <tr>
                          {sqlPreview.columns.map((column) => (
                            <th key={column} className="px-2 py-2 text-left whitespace-nowrap">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sqlPreview.rows.map((row, rowIndex) => (
                          <tr key={`sql-${rowIndex}`} className="border-b last:border-0">
                            {sqlPreview.columns.map((column) => (
                              <td key={`${rowIndex}-${column}`} className="px-2 py-2 whitespace-nowrap">
                                {String(row[column] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
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
