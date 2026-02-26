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
import { Textarea } from '@/components/ui/textarea';
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

const SQL_TEMPLATES = [
  {
    label: 'Latest Samples',
    sql: `SELECT
  m.observed_at,
  s.code AS station_code,
  v.code AS variable_code,
  m.value,
  m.unit
FROM measurements m
JOIN stations s ON s.id = m.station_id
JOIN variables v ON v.id = m.variable_id
ORDER BY m.observed_at DESC`,
  },
  {
    label: 'Daily Aggregation',
    sql: `SELECT
  date_trunc('day', m.observed_at) AS day,
  s.code AS station_code,
  v.code AS variable_code,
  AVG(m.value) AS avg_value
FROM measurements m
JOIN stations s ON s.id = m.station_id
JOIN variables v ON v.id = m.variable_id
GROUP BY 1, 2, 3
ORDER BY day DESC`,
  },
];

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

function intensityColor(value: number, min: number, max: number): string {
  if (max <= min) {
    return 'hsl(205, 80%, 88%)';
  }
  const ratio = (value - min) / (max - min);
  const lightness = 92 - ratio * 38;
  return `hsl(205, 72%, ${lightness}%)`;
}

export function AnalyticalWorkspace() {
  const [filters, setFilters] = useState<AnalyticsFilterOptionsResponse | null>(null);
  const [rows, setRows] = useState<AnalyticsDataRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [chartType, setChartType] = useState<ChartType>('line');
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangePreset, setRangePreset] = useState<string>('all');
  const [sourceSearch, setSourceSearch] = useState('');
  const [rowLimit, setRowLimit] = useState(5000);
  const [bootstrapReady, setBootstrapReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [liveSnapshot, setLiveSnapshot] = useState<StationLiveSnapshotResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const [sqlText, setSqlText] = useState(SQL_TEMPLATES[0].sql);
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

  const splitLineByStation = selectedStations.length > 1;
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

  const runAnalysis = useCallback(
    async ({
      sourceId,
      stationCodes,
      fromDate,
      toDate,
      requestedLimit,
    }: {
      sourceId: number | null;
      stationCodes: string[];
      fromDate: string;
      toDate: string;
      requestedLimit: number;
    }) => {
      if (sourceId === null) {
        setRows([]);
        setError('Select a source file to visualize data.');
        return;
      }

      const sourceForLimit = filters?.sources.find((source) => source.id === sourceId);
      const datasetMaxRows = Math.max(100, sourceForLimit?.row_count ?? requestedLimit);
      const effectiveLimit = Math.max(100, Math.min(requestedLimit, datasetMaxRows));
      const normalizedRange = normalizeDateRange(fromDate, toDate);
      const payload: AnalyticsQueryRequest = {
        source_file_ids: [sourceId],
        station_codes: stationCodes.length > 0 ? stationCodes : undefined,
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
        setRowLimit(Math.max(100, Math.min(5000, firstSource?.row_count ?? 5000)));
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
        fromDate: dateFrom,
        toDate: dateTo,
        requestedLimit: rowLimit,
      });
    }, 130);

    return () => clearTimeout(timeout);
  }, [bootstrapReady, selectedSourceId, selectedStations, dateFrom, dateTo, rowLimit, runAnalysis]);

  useEffect(() => {
    setRowLimit((current) => Math.min(Math.max(100, current), sourceMaxRows));
  }, [sourceMaxRows]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    void refreshLiveSnapshot(selectedStations);
  }, [bootstrapReady, selectedStations, refreshLiveSnapshot]);

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
      setRangePreset(presetId);
      return;
    }

    const from = addDays(maxDate, -(preset.days - 1));
    const boundedFrom = minDate && from < minDate ? minDate : from;
    setDateFrom(boundedFrom);
    setDateTo(maxDate);
    setRangePreset(presetId);
  };

  const handleRunClick = () => {
    void runAnalysis({
      sourceId: selectedSourceId,
      stationCodes: selectedStations,
      fromDate: dateFrom,
      toDate: dateTo,
      requestedLimit: rowLimit,
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

  const handleRunSqlPreview = async () => {
    setSqlLoading(true);
    setSqlError(null);
    try {
      const response = await runSqlPreview({ sql: sqlText, limit: sqlLimit });
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
                    (splitLineByStation
                      ? 'Color-coded lines by station for multi-station comparison'
                      : `Temporal trends grouped by ${granularity}`)}
                  {chartType === 'bar' && 'Average concentration by station'}
                  {chartType === 'scatter' && 'Hourly dispersion with station-based colors'}
                  {chartType === 'heatmap' && 'Day-hour intensity matrix'}
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                      <div className="min-w-[780px]">
                        <div className="grid grid-cols-[84px_repeat(24,minmax(26px,1fr))] gap-1">
                          <div />
                          {heatmap.hours.map((hour) => (
                            <div key={`hour-${hour}`} className="text-[10px] text-center text-muted-foreground">
                              {hour}
                            </div>
                          ))}
                          {heatmap.days.map((day) => (
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
                <CardDescription>Read-only SQL for fast table samples.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {SQL_TEMPLATES.map((template) => (
                    <Button
                      key={template.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSqlText(template.sql)}
                    >
                      {template.label}
                    </Button>
                  ))}
                </div>

                <Textarea
                  value={sqlText}
                  onChange={(event) => setSqlText(event.target.value)}
                  className="font-mono text-xs h-36 bg-[#f8fbff]"
                />

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
