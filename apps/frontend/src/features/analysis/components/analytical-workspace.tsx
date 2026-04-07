import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
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
  getManualDatasetAnalyticsPreview,
  listManualDatasets,
  type ManualDatasetResponse,
} from '@/api/modules/etl';
import {
  getAnalyticsFilters,
  runAnalyticsQuery,
  type AnalyticsDataRow,
  type AnalyticsFilterOptionsResponse,
  type AnalyticsQueryRequest,
} from '@/api/modules/analytics';
import { runEdaPlot, type EdaChartType, type EdaPlotResponse } from '@/api/modules/eda';
import { PlotlyChart } from '@/components/common/plotly-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useWorkspace } from '@/contexts/workspace-context';

type ChartType = 'line' | 'bar' | 'scatter' | 'heatmap';
type TimeGranularity = 'hour' | 'day' | 'month' | 'year';

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

function buildLocalSummary(rows: AnalyticsDataRow[]): {
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

export function AnalyticalWorkspace() {
  const [filters, setFilters] = useState<AnalyticsFilterOptionsResponse | null>(null);
  const [manualDatasets, setManualDatasets] = useState<ManualDatasetResponse[]>([]);
  const [rows, setRows] = useState<AnalyticsDataRow[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [selectedManualDatasetId, setSelectedManualDatasetId] = useState<string | null>(null);
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
  const [labSection, setLabSection] = useState<LabSection>('load-data');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [summaryChartType, setSummaryChartType] = useState<EdaChartType>('histogram');
  const [correlationChartType, setCorrelationChartType] = useState<EdaChartType>('heatmap');
  const [genericXAxis, setGenericXAxis] = useState('');
  const [genericYAxis, setGenericYAxis] = useState('');
  const [genericHue, setGenericHue] = useState('');
  const [genericFacetRow, setGenericFacetRow] = useState('');
  const [genericFacetCol, setGenericFacetCol] = useState('');
  const [genericCategoryOrderInput, setGenericCategoryOrderInput] = useState('');
  const [timeIsHere, setTimeIsHere] = useState(true);
  const [showStdBand, setShowStdBand] = useState(true);
  const [normalizeDensity, setNormalizeDensity] = useState(false);
  const [cumulativeDensity, setCumulativeDensity] = useState(false);
  const [swarmOverlay, setSwarmOverlay] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [manualDatasetsLoading, setManualDatasetsLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plotLoading, setPlotLoading] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [plotResponse, setPlotResponse] = useState<EdaPlotResponse | null>(null);

  const requestIdRef = useRef(0);
  const plotRequestIdRef = useRef(0);
  const { activeWorkspaceId } = useWorkspace();

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

  const finalizedManualDatasets = useMemo(
    () =>
      manualDatasets.filter(
        (dataset) => dataset.status.startsWith('finalized') && dataset.source_kind !== 'remmaq',
      ),
    [manualDatasets],
  );
  const filteredManualDatasets = useMemo(() => {
    const keyword = sourceSearch.trim().toLowerCase();
    if (!keyword) {
      return finalizedManualDatasets;
    }
    return finalizedManualDatasets.filter((dataset) => {
      const haystack = `${dataset.name} ${dataset.original_file_name} ${dataset.dataset_kind ?? ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [finalizedManualDatasets, sourceSearch]);
  const selectedManualDataset = useMemo(
    () => finalizedManualDatasets.find((dataset) => dataset.id === selectedManualDatasetId) ?? null,
    [finalizedManualDatasets, selectedManualDatasetId],
  );
  const manualDatasetColumnOptions = useMemo(
    () =>
      (selectedManualDataset?.columns ?? []).map((column) => ({
        code: column.name,
        name: column.name,
        inferredKind: column.inferred_kind,
      })),
    [selectedManualDataset],
  );
  const isGenericManualDataset = selectedManualDataset?.dataset_kind === 'generic';
  const isMeasurementManualDataset = selectedManualDataset?.dataset_kind === 'measurements';

  const selectedSources = useMemo(() => {
    if (!filters || selectedSourceIds.length === 0) {
      return [];
    }
    const selectedSet = new Set(selectedSourceIds);
    return filters.sources.filter((source) => selectedSet.has(source.id));
  }, [filters, selectedSourceIds]);
  const availableVariables = useMemo(() => {
    if (selectedManualDataset) {
      if (manualDatasetColumnOptions.length > 0) {
        return manualDatasetColumnOptions;
      }
      const grouped = new Map<string, string>();
      for (const row of rows) {
        grouped.set(row.variable_code, row.variable_name || row.variable_code);
      }
      return Array.from(grouped.entries()).map(([code, name]) => ({ code, name }));
    }
    if (!filters) {
      return [];
    }
    if (selectedSources.length === 0) {
      return filters.variables;
    }
    const allowedCodes = new Set(selectedSources.flatMap((source) => source.variable_codes));
    return filters.variables.filter((variable) => allowedCodes.has(variable.code));
  }, [filters, manualDatasetColumnOptions, rows, selectedManualDataset, selectedSources]);
  const availableVariableCodes = useMemo(
    () => availableVariables.map((variable) => variable.code),
    [availableVariables],
  );
  const availableStations = useMemo(() => {
    if (selectedManualDataset && !isMeasurementManualDataset) {
      return [];
    }
    if (selectedManualDatasetId && rows.length > 0) {
      const grouped = new Map<string, string>();
      for (const row of rows) {
        grouped.set(row.station_code, row.station_name || row.station_code);
      }
      return Array.from(grouped.entries()).map(([code, name]) => ({ code, name }));
    }
    return filters?.stations ?? [];
  }, [filters, isMeasurementManualDataset, rows, selectedManualDataset, selectedManualDatasetId]);
  const sourceMaxRows = useMemo(
    () =>
      Math.max(
        100,
        selectedManualDataset
          ? selectedManualDataset.row_count || 5000
          : selectedSources.reduce((total, source) => total + source.row_count, 0) || 5000,
      ),
    [selectedManualDataset, selectedSources],
  );

  const summary = useMemo(() => buildLocalSummary(rows), [rows]);
  const exploredDateRange = useMemo(
    () => applyExploreRange(dateFrom, dateTo, exploreRange),
    [dateFrom, dateTo, exploreRange],
  );
  const pairVariableOptions = useMemo(
    () => availableVariables.map((variable) => variable.code),
    [availableVariables],
  );

  const runAnalysis = useCallback(
    async ({
      sourceIds,
      manualDatasetId,
      stationCodes,
      variableCodes,
      fromDate,
      toDate,
      requestedLimit,
      rangePercent,
    }: {
      sourceIds: number[];
      manualDatasetId: string | null;
      stationCodes: string[];
      variableCodes: string[];
      fromDate: string;
      toDate: string;
      requestedLimit: number;
      rangePercent: [number, number];
    }) => {
      if (sourceIds.length === 0 && !manualDatasetId) {
        setRows([]);
        setError('Select at least one data source to visualize.');
        return;
      }

      if (manualDatasetId && !isMeasurementManualDataset) {
        setRows([]);
        setError(null);
        return;
      }

      const selectedSet = new Set(sourceIds);
      const datasetMaxRows = manualDatasetId
        ? Math.max(100, selectedManualDataset?.row_count ?? requestedLimit)
        : Math.max(
            100,
            filters?.sources
              .filter((source) => selectedSet.has(source.id))
              .reduce((total, source) => total + source.row_count, 0) ?? requestedLimit,
          );
      const effectiveLimit = Math.max(100, Math.min(requestedLimit, datasetMaxRows));
      const exploredRange = applyExploreRange(fromDate, toDate, rangePercent);
      const normalizedRange = normalizeDateRange(exploredRange.from, exploredRange.to);

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      setLoading(true);
      setError(null);
      try {
        const response = manualDatasetId
          ? await getManualDatasetAnalyticsPreview(manualDatasetId, {
              station_codes: stationCodes.length > 0 ? stationCodes : undefined,
              variable_codes: variableCodes.length > 0 ? variableCodes : undefined,
              date_from: normalizedRange.from,
              date_to: normalizedRange.to,
              limit: effectiveLimit,
            })
          : await runAnalyticsQuery({
              source_file_ids: sourceIds,
              station_codes: stationCodes.length > 0 ? stationCodes : undefined,
              variable_codes: variableCodes.length > 0 ? variableCodes : undefined,
              date_from: normalizedRange.from,
              date_to: normalizedRange.to,
              limit: effectiveLimit,
            } satisfies AnalyticsQueryRequest);
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
    [filters, isMeasurementManualDataset, selectedManualDataset],
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
    if (!activeWorkspaceId) {
      setManualDatasets([]);
      return;
    }

    let cancelled = false;

    const loadManualDatasets = async () => {
      setManualDatasetsLoading(true);
      try {
        const datasets = await listManualDatasets(activeWorkspaceId);
        if (!cancelled) {
          setManualDatasets(datasets);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load saved datasets.');
        }
      } finally {
        if (!cancelled) {
          setManualDatasetsLoading(false);
        }
      }
    };

    void loadManualDatasets();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }

    const timeout = setTimeout(() => {
      void runAnalysis({
        sourceIds: selectedSourceIds,
        manualDatasetId: selectedManualDatasetId,
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
    selectedManualDatasetId,
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
    const availableVariables = pairVariableOptions;
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
  }, [pairVariableOptions, pairVariableX, pairVariableY]);

  useEffect(() => {
    if (!selectedManualDataset) {
      return;
    }

    const allColumns = selectedManualDataset.columns.map((column) => column.name);
    const datetimeColumns = selectedManualDataset.summary.datetime_columns ?? [];
    const numericColumns = selectedManualDataset.summary.numeric_columns ?? [];
    const categoricalColumns = selectedManualDataset.summary.categorical_columns ?? [];

    setGenericXAxis((current) =>
      current && allColumns.includes(current)
        ? current
        : datetimeColumns[0] ?? categoricalColumns[0] ?? numericColumns[0] ?? allColumns[0] ?? '',
    );
    setGenericYAxis((current) =>
      current && allColumns.includes(current) ? current : numericColumns[0] ?? '',
    );
    setGenericHue((current) =>
      current && allColumns.includes(current) ? current : categoricalColumns[0] ?? '',
    );
    setGenericFacetRow((current) => (current && allColumns.includes(current) ? current : ''));
    setGenericFacetCol((current) => (current && allColumns.includes(current) ? current : ''));
  }, [selectedManualDataset]);

  const runPlotRequest = useCallback(async () => {
    const selectedDataSourceCount = selectedSourceIds.length + (selectedManualDatasetId ? 1 : 0);
    if (labSection === 'load-data' || selectedDataSourceCount === 0) {
      setPlotResponse(null);
      setPlotError(null);
      return;
    }

    const requestId = plotRequestIdRef.current + 1;
    plotRequestIdRef.current = requestId;
    const normalizedRange = normalizeDateRange(exploredDateRange.from, exploredDateRange.to);
    const activeEdaSection = labSection;
    const chartTypeForSection =
      activeEdaSection === 'rolling'
        ? chartType
        : activeEdaSection === 'summary'
          ? summaryChartType
          : activeEdaSection === 'correlation'
            ? correlationChartType
            : null;

    setPlotLoading(true);
    setPlotError(null);
    try {
      const response = await runEdaPlot({
        section: activeEdaSection,
        source_file_ids: selectedSourceIds,
        manual_dataset_id: selectedManualDatasetId,
        station_codes: selectedStations,
        variable_codes: selectedVariables,
        date_from: normalizedRange.from ?? undefined,
        date_to: normalizedRange.to ?? undefined,
        limit: rowLimit,
        granularity,
        chart_type: chartTypeForSection,
        rolling_window: rollingWindow,
        decomposition_window: decompositionWindow,
        forecast_horizon: forecastHorizon,
        changepoint_window: changepointWindow,
        changepoint_sensitivity: changepointSensitivity,
        profile_mode: labSection === 'seasonality' ? seasonalityMode : profileMode,
        profile_aggregation: profileAggregation,
        profile_heatmap_mode: profileHeatmapMode,
        trend_deseasonalized: trendDeseasonalized,
        pair_variable_x: pairVariableX || undefined,
        pair_variable_y: pairVariableY || undefined,
        x_axis: genericXAxis || undefined,
        y_axis: genericYAxis || undefined,
        hue: genericHue || undefined,
        facet_row: genericFacetRow || undefined,
        facet_col: genericFacetCol || undefined,
        category_order: genericCategoryOrderInput
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        time_is_here: timeIsHere,
        show_std_band: showStdBand,
        cumulative: cumulativeDensity,
        normalize_density: normalizeDensity,
        swarm_overlay: swarmOverlay,
      });
      if (requestId !== plotRequestIdRef.current) {
        return;
      }
      setPlotResponse(response);
    } catch (err) {
      if (requestId !== plotRequestIdRef.current) {
        return;
      }
      setPlotResponse(null);
      setPlotError(err instanceof Error ? err.message : 'Failed to build the Plotly figure.');
    } finally {
      if (requestId === plotRequestIdRef.current) {
        setPlotLoading(false);
      }
    }
  }, [
    labSection,
    chartType,
    changepointSensitivity,
    changepointWindow,
    correlationChartType,
    cumulativeDensity,
    decompositionWindow,
    exploredDateRange.from,
    exploredDateRange.to,
    forecastHorizon,
    genericCategoryOrderInput,
    genericFacetCol,
    genericFacetRow,
    genericHue,
    genericXAxis,
    genericYAxis,
    granularity,
    pairVariableX,
    pairVariableY,
    profileAggregation,
    profileHeatmapMode,
    profileMode,
    rollingWindow,
    rowLimit,
    selectedManualDatasetId,
    selectedSourceIds,
    selectedStations,
    selectedVariables,
    seasonalityMode,
    showStdBand,
    summaryChartType,
    swarmOverlay,
    timeIsHere,
    trendDeseasonalized,
    normalizeDensity,
  ]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void runPlotRequest();
    }, 150);

    return () => clearTimeout(timeout);
  }, [runPlotRequest]);

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
      manualDatasetId: selectedManualDatasetId,
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
    setSelectedManualDatasetId(null);
    setSelectedSourceIds((current) => {
      if (current.includes(sourceId)) {
        return current.filter((item) => item !== sourceId);
      }
      return [...current, sourceId];
    });
  };
  const handleSelectManualDataset = (datasetId: string) => {
    setSelectedSourceIds([]);
    setSelectedManualDatasetId((current) => (current === datasetId ? null : datasetId));
    setSelectedStations([]);
    setSelectedVariables([]);
    setDateFrom('');
    setDateTo('');
    setRangePreset('all');
    setExploreRange([0, 100]);
  };

  const activeSection = ANALYSIS_SECTIONS.find((section) => section.value === labSection) ?? ANALYSIS_SECTIONS[0];
  const ActiveSectionIcon = activeSection.icon;
  const selectedVariableLabels = selectedVariables.map(
    (code) => availableVariables.find((variable) => variable.code === code)?.name ?? code,
  );
  const selectedDataSourceCount = selectedSourceIds.length + (selectedManualDatasetId ? 1 : 0);
  const plotStats = plotResponse?.stats ?? {};
  const plotWarnings = plotResponse?.warnings ?? [];
  const plotVariableSummary = Array.isArray(plotStats.variable_summary)
    ? (plotStats.variable_summary as Record<string, unknown>[])
    : [];
  const statSamples =
    typeof plotStats.samples === 'number' ? Number(plotStats.samples) : summary.samples;
  const statMean = typeof plotStats.mean === 'number' ? Number(plotStats.mean) : summary.mean;
  const statTrend =
    typeof plotStats.trend === 'string' ? plotStats.trend : summary.trend;
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
      if (isGenericManualDataset) {
        return <div className="mb-4">{renderGranularityControl('Bucketing')}</div>;
      }
      return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-2 mb-4">
          {renderGranularityControl('Bucketing')}
          <Select value={pairVariableX} onValueChange={setPairVariableX}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Variable X" />
            </SelectTrigger>
            <SelectContent>
              {pairVariableOptions.map((variable) => (
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
              {pairVariableOptions.map((variable) => (
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

  const renderAnalysisChart = () => {
    if (plotLoading) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-white">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Building Plotly figure...
        </div>
      );
    }

    if (plotError) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-white px-6 text-center">
          {plotError}
        </div>
      );
    }

    if (!plotResponse) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-white">
          Load data from the source section before opening this analysis.
        </div>
      );
    }

    return <PlotlyChart figure={plotResponse.figure_json} height={560} />;
  };

  const renderInlinePlotControls = () => {
    const columnOptions = manualDatasetColumnOptions;
    const canUseGenericAxes = isGenericManualDataset && columnOptions.length > 0;
    const currentPlotType = labSection === 'rolling' ? chartType : labSection === 'summary' ? summaryChartType : correlationChartType;
    const showTimeIsHereControl = canUseGenericAxes && labSection === 'rolling';
    const showStdBandControl = labSection === 'rolling' && currentPlotType === 'line';
    const showNormalizeDensityControl = labSection === 'summary' && (summaryChartType === 'histogram' || summaryChartType === 'kde');
    const showCumulativeDensityControl = labSection === 'summary' && summaryChartType === 'kde';
    const showSwarmOverlayControl = labSection === 'summary' && (summaryChartType === 'box' || summaryChartType === 'violin');

    return (
      <Card className="bg-[#fbfdff] border-[#dce5f1] h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Plot Controls</CardTitle>
          <CardDescription>Dynamic options scoped to the active chart.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(labSection === 'summary' || labSection === 'correlation') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Plot Family</Label>
              <Select
                value={currentPlotType}
                onValueChange={(value) => {
                  if (labSection === 'summary') {
                    setSummaryChartType(value as EdaChartType);
                    return;
                  }
                  setCorrelationChartType(value as EdaChartType);
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Plot family" />
                </SelectTrigger>
                <SelectContent>
                  {labSection === 'summary' ? (
                    <>
                      <SelectItem value="histogram">Histogram</SelectItem>
                      <SelectItem value="kde">KDE</SelectItem>
                      <SelectItem value="box">Boxplot</SelectItem>
                      <SelectItem value="violin">Violin</SelectItem>
                      <SelectItem value="missing">Missing Data</SelectItem>
                      <SelectItem value="ridge">Ridgeplot</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="heatmap">Heatmap</SelectItem>
                      <SelectItem value="scatter">Scatter</SelectItem>
                      <SelectItem value="regression">Regression</SelectItem>
                      <SelectItem value="pairplot">Pairplot</SelectItem>
                      <SelectItem value="missing">Missing Data</SelectItem>
                      <SelectItem value="ridge">Ridgeplot</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {canUseGenericAxes && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">X Axis</Label>
                <Select value={genericXAxis} onValueChange={setGenericXAxis}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="X axis" />
                  </SelectTrigger>
                  <SelectContent>
                    {columnOptions.map((column) => (
                      <SelectItem key={`generic-x-${column.code}`} value={column.code}>
                        {column.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Y Axis</Label>
                <Select value={genericYAxis} onValueChange={setGenericYAxis}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Y axis" />
                  </SelectTrigger>
                  <SelectContent>
                    {columnOptions.map((column) => (
                      <SelectItem key={`generic-y-${column.code}`} value={column.code}>
                        {column.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hue</Label>
                <Select value={genericHue || '__none__'} onValueChange={(value) => setGenericHue(value === '__none__' ? '' : value)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Hue" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {columnOptions.map((column) => (
                      <SelectItem key={`generic-hue-${column.code}`} value={column.code}>
                        {column.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Facet Row</Label>
                  <Select
                    value={genericFacetRow || '__none__'}
                    onValueChange={(value) => setGenericFacetRow(value === '__none__' ? '' : value)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Facet row" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {columnOptions.map((column) => (
                        <SelectItem key={`generic-row-${column.code}`} value={column.code}>
                          {column.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Facet Col</Label>
                  <Select
                    value={genericFacetCol || '__none__'}
                    onValueChange={(value) => setGenericFacetCol(value === '__none__' ? '' : value)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Facet col" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {columnOptions.map((column) => (
                        <SelectItem key={`generic-col-${column.code}`} value={column.code}>
                          {column.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category-order" className="text-xs text-muted-foreground">
                  Custom order
                </Label>
                <Input
                  id="category-order"
                  value={genericCategoryOrderInput}
                  onChange={(event) => setGenericCategoryOrderInput(event.target.value)}
                  placeholder="cat A, cat B, cat C"
                  className="h-9 text-xs"
                />
              </div>
            </>
          )}

          {(showTimeIsHereControl || showStdBandControl) && (
            <div className="space-y-2 rounded-lg border bg-white p-3">
              {showTimeIsHereControl && (
                <button
                  type="button"
                  onClick={() => setTimeIsHere((current) => !current)}
                  className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                    timeIsHere ? 'bg-[#509EE3] text-white border-[#509EE3]' : 'bg-white text-foreground border-gray-300'
                  }`}
                >
                  {timeIsHere ? 'Time is here: on' : 'Time is here: off'}
                </button>
              )}
              {showStdBandControl && (
                <button
                  type="button"
                  onClick={() => setShowStdBand((current) => !current)}
                  className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                    showStdBand ? 'bg-[#0B7285] text-white border-[#0B7285]' : 'bg-white text-foreground border-gray-300'
                  }`}
                >
                  {showStdBand ? 'Std band: on' : 'Std band: off'}
                </button>
              )}
            </div>
          )}

          {(showNormalizeDensityControl || showCumulativeDensityControl || showSwarmOverlayControl) && (
            <div className="space-y-2 rounded-lg border bg-white p-3">
              {showNormalizeDensityControl && (
                <button
                  type="button"
                  onClick={() => setNormalizeDensity((current) => !current)}
                  className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                    normalizeDensity ? 'bg-[#1F5A8A] text-white border-[#1F5A8A]' : 'bg-white text-foreground border-gray-300'
                  }`}
                >
                  {normalizeDensity ? 'Normalized density: on' : 'Normalized density: off'}
                </button>
              )}
              {showCumulativeDensityControl && (
                <button
                  type="button"
                  onClick={() => setCumulativeDensity((current) => !current)}
                  className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                    cumulativeDensity ? 'bg-[#16A34A] text-white border-[#16A34A]' : 'bg-white text-foreground border-gray-300'
                  }`}
                >
                  {cumulativeDensity ? 'Cumulative: on' : 'Cumulative: off'}
                </button>
              )}
              {showSwarmOverlayControl && (
                <button
                  type="button"
                  onClick={() => setSwarmOverlay((current) => !current)}
                  className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                    swarmOverlay ? 'bg-[#A16207] text-white border-[#A16207]' : 'bg-white text-foreground border-gray-300'
                  }`}
                >
                  {swarmOverlay ? 'Swarm overlay: on' : 'Swarm overlay: off'}
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderSecondaryContent = () => {
    const secondaryFigures = plotResponse?.secondary_figures ?? [];
    const trendDirection = typeof plotStats.trendDirection === 'string' ? plotStats.trendDirection : null;
    const trendSlope = typeof plotStats.linearSlope === 'number' ? plotStats.linearSlope : null;
    const trendR2 = typeof plotStats.linearR2 === 'number' ? plotStats.linearR2 : null;
    const changepointThreshold =
      typeof plotStats.changepoint_threshold === 'number' ? plotStats.changepoint_threshold : null;
    const changepointCount = typeof plotStats.changepoint_count === 'number' ? plotStats.changepoint_count : null;

    return (
      <div className="space-y-4">
        {secondaryFigures.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {secondaryFigures.map((figure) => (
              <Card key={figure.key} className="bg-white border-[#dce5f1]">
                <CardHeader>
                  <CardTitle className="text-lg">{figure.title}</CardTitle>
                  {figure.description && <CardDescription>{figure.description}</CardDescription>}
                </CardHeader>
                <CardContent>
                  <div className="h-[320px] w-full">
                    <PlotlyChart figure={figure.figure_json} height={320} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {labSection === 'summary' && plotVariableSummary.length > 0 && (
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
                    {plotVariableSummary.map((item, index) => (
                      <tr key={`summary-row-${index}`} className="hover:bg-[#F9FBFC]">
                        <td className="border border-gray-200 p-2 font-medium">{String(item.label ?? item.code ?? '--')}</td>
                        <td className="border border-gray-200 p-2 text-right">{String(item.count ?? '--')}</td>
                        <td className="border border-gray-200 p-2 text-right">{round(Number(item.mean ?? 0))}</td>
                        <td className="border border-gray-200 p-2 text-right">{round(Number(item.std ?? 0))}</td>
                        <td className="border border-gray-200 p-2 text-right">{round(Number(item.min ?? 0))}</td>
                        <td className="border border-gray-200 p-2 text-right">{round(Number(item.median ?? 0))}</td>
                        <td className="border border-gray-200 p-2 text-right">{round(Number(item.max ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {labSection === 'trend' && trendDirection && trendSlope !== null && trendR2 !== null && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard label="Slope" value={round(trendSlope, 6).toString()} icon={TrendingUp} />
            <KpiCard label="R2" value={round(trendR2, 4).toString()} icon={BarChart3} />
            <KpiCard
              label="Direction"
              value={trendDirection}
              icon={LineChartIcon}
              badgeTone={trendDirection === 'Rising' ? 'green' : trendDirection === 'Falling' ? 'amber' : 'blue'}
            />
          </div>
        )}

        {labSection === 'changepoints' && changepointThreshold !== null && changepointCount !== null && (
          <div className="rounded-md border bg-[#f8fbff] px-3 py-2 text-xs text-muted-foreground">
            Threshold: {round(changepointThreshold, 4)} · Detected changepoints: {changepointCount}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex bg-[#F9FBFC]">
      <aside className={`${sidebarCollapsed ? 'w-20' : 'w-72'} shrink-0 border-r border-gray-200 bg-white flex flex-col transition-[width] duration-200`}>
        <div className={`border-b border-gray-200 ${sidebarCollapsed ? 'px-2 py-3' : 'px-4 py-4'}`}>
          <div className="flex items-center justify-between gap-2">
            {!sidebarCollapsed && (
              <div>
                <h2 className="font-semibold text-foreground mb-1">Analysis Section</h2>
                <p className="text-xs text-muted-foreground">Select analysis type and keep charts in focus</p>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
              title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {ANALYSIS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = labSection === section.value;
              const locked = section.value !== 'load-data' && selectedDataSourceCount === 0;

              return (
                <button
                  key={section.value}
                  type="button"
                  onClick={() => setLabSection(section.value)}
                  className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg text-sm transition-all ${
                    isActive ? 'bg-[#509EE3] text-white shadow-md' : 'hover:bg-gray-100 text-foreground'
                  }`}
                  title={section.label}
                >
                  <Icon className="w-4 h-4" style={{ color: isActive ? 'white' : section.color }} />
                  {!sidebarCollapsed && <span className="flex-1 text-left">{section.label}</span>}
                  {locked && <div className="w-2 h-2 rounded-full bg-orange-400" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {!sidebarCollapsed && labSection !== 'load-data' && (
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
                  <span className="font-medium text-foreground">{selectedDataSourceCount}</span>
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
                {selectedDataSourceCount > 0 ? `${selectedDataSourceCount} sources selected` : 'No sources selected'}
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
                    <Label className="text-xs text-muted-foreground">Sources</Label>
                    <div className="relative mt-2">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={sourceSearch}
                        onChange={(event) => setSourceSearch(event.target.value)}
                        placeholder="Search source..."
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
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#509EE3]/10">
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
                        {filteredManualDatasets.map((dataset) => {
                          const active = selectedManualDatasetId === dataset.id;
                          return (
                            <button
                              key={dataset.id}
                              type="button"
                              onClick={() => handleSelectManualDataset(dataset.id)}
                              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                active
                                  ? 'border-[#509EE3] bg-[#e9f3fd]'
                                  : 'border-gray-200 bg-white hover:border-[#509EE3]/35'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#509EE3]/10">
                                  <Database className="w-4 h-4 text-[#509EE3]" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{dataset.name}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    manual dataset · {dataset.row_count.toLocaleString()} rows
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {manualDatasetsLoading && (
                          <p className="text-xs text-muted-foreground py-4 text-center">Loading datasets...</p>
                        )}
                        {filteredSources.length === 0 && (
                          filteredManualDatasets.length === 0 && !manualDatasetsLoading ? (
                            <p className="text-xs text-muted-foreground py-6 text-center">No matching sources.</p>
                          ) : null
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
                        {availableStations.map((station) => {
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
                          <span className="font-medium text-foreground">
                            {selectedManualDatasetId ? '1 dataset' : `${selectedSourceIds.length} files`}
                          </span>
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
                <KpiCard label="Sources" value={selectedDataSourceCount.toString()} icon={Database} />
                <KpiCard label="Samples" value={statSamples.toLocaleString()} icon={Table2} />
                <KpiCard label="Mean" value={round(statMean).toString()} icon={TrendingUp} />
                <KpiCard
                  label="Trend"
                  value={statTrend}
                  icon={LineChartIcon}
                  badgeTone={statTrend === 'Rising' ? 'green' : statTrend === 'Falling' ? 'amber' : 'blue'}
                />
              </div>

              {plotWarnings.length > 0 && (
                <Card className="bg-white border-l-4 border-l-amber-400">
                  <CardContent className="py-3 space-y-1">
                    {plotWarnings.map((warning, index) => (
                      <p key={`plot-warning-${index}`} className="text-sm text-amber-800">
                        {warning}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              )}

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
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
                    <div>
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
                    </div>
                    {renderInlinePlotControls()}
                  </div>
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
