import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  LineChart as LineChartIcon,
  Loader2,
  Table2,
  TrendingUp,
} from 'lucide-react';

import { getAppConfig } from '@/api/modules/app-config';
import type { EdaChartType } from '@/api/modules/eda';
import { PlotlyFigurePanel } from '@/components/common/plotly-figure-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspace } from '@/contexts/workspace-context';
import { AnalyticalWorkspaceAdvancedPanel } from '@/features/analysis/components/analytical-workspace-advanced-panel';
import { AnalyticalWorkspaceInlinePlotControls } from '@/features/analysis/components/analytical-workspace-inline-plot-controls';
import { AnalyticalWorkspaceKpiCard as KpiCard } from '@/features/analysis/components/analytical-workspace-kpi-card';
import { AnalyticalWorkspaceLoadDataPanel } from '@/features/analysis/components/analytical-workspace-load-data-panel';
import { AnalyticalWorkspaceSecondaryContent } from '@/features/analysis/components/analytical-workspace-secondary-content';
import { AnalyticalWorkspaceSectionControls } from '@/features/analysis/components/analytical-workspace-section-controls';
import { AnalyticalWorkspaceSidebar } from '@/features/analysis/components/analytical-workspace-sidebar';
import { AnalyticalWorkspaceVariableSelector } from '@/features/analysis/components/analytical-workspace-variable-selector';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import { useAnalyticalWorkspaceController } from '@/features/analysis/hooks/use-analytical-workspace-controller';
import {
  addDays,
  ANALYSIS_SECTIONS,
  buildLocalSummary,
  getLabSectionDescription,
  isTimeNavigableSection,
  normalizeDateRange,
  RANGE_PRESETS,
  round,
  toIsoDate,
  type AggregationMode,
  type ChartType,
  type HeatmapProfileMode,
  type LabSection,
  type ProfileMode,
} from '@/features/analysis/lib/analytical-workspace-config';

type VariableSelectionScope = Exclude<LabSection, 'load-data'> | 'advanced';

const VARIABLE_SELECTION_SCOPES: VariableSelectionScope[] = [
  'rolling',
  'distribution',
  'scatter',
  'data_trend',
  'time_profiles',
  'heat_map',
  'seasonality',
  'autocorr',
  'pacf',
  'anomaly',
  'decomposition',
  'profiles',
  'forecast',
  'changepoints',
  'trend',
  'correlation',
  'summary',
  'advanced',
];

const REFERENCE_MULTI_OUTPUT_SECTIONS = new Set<LabSection>([
  'rolling',
  'distribution',
  'data_trend',
  'anomaly',
  'forecast',
  'changepoints',
  'trend',
  'correlation',
  'summary',
]);

const REFERENCE_SINGLE_OUTPUT_SECTIONS = new Set<LabSection>([
  'seasonality',
  'autocorr',
  'pacf',
  'decomposition',
  'profiles',
  'time_profiles',
  'heat_map',
]);

const DESCRIPTIVE_ANALYTICS_SECTIONS: LabSection[] = [
  'summary',
  'distribution',
  'scatter',
  'data_trend',
  'time_profiles',
  'heat_map',
];

function getDefaultVariableSelection(scope: VariableSelectionScope, availableCodes: string[]) {
  if (availableCodes.length === 0) {
    return [];
  }

  const desiredCount = scope === 'correlation' ? Math.min(2, availableCodes.length) : Math.min(2, availableCodes.length);
  return availableCodes.slice(0, desiredCount);
}

export function AnalyticalWorkspaceScreen() {
  const {
    selectedSourceIds,
    setSelectedSourceIds,
    selectedManualDatasetId,
    setSelectedManualDatasetId,
    selectedStations,
    setSelectedStations,
    granularity,
    setGranularity,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    setRangePreset,
    sourceSearch,
    rowLimit,
    setRowLimit,
    plotViewport,
    setPlotViewport,
    timeAggregation,
    setTimeAggregation,
  } = useAnalyticalWorkspaceState();
  const [chartType, setChartType] = useState<ChartType>('line');
  const [labSection, setLabSection] = useState<LabSection>('load-data');
  const [workspaceMode, setWorkspaceMode] = useState<'exploration' | 'advanced'>('exploration');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rollingWindow, setRollingWindow] = useState(0);
  const [seasonalityMode, setSeasonalityMode] = useState<'weekday' | 'month' | 'hour'>('weekday');
  const [decompositionWindow, setDecompositionWindow] = useState(21);
  const [profileMode, setProfileMode] = useState<ProfileMode>('hour');
  const [profileAggregation, setProfileAggregation] = useState<AggregationMode>('mean');
  const [profileHeatmapMode, setProfileHeatmapMode] = useState<HeatmapProfileMode>('month');
  const [forecastHorizon, setForecastHorizon] = useState(30);
  const [changepointWindow, setChangepointWindow] = useState(7);
  const [changepointSensitivity, setChangepointSensitivity] = useState(2);
  const [trendDeseasonalized, setTrendDeseasonalized] = useState(false);
  const [pairVariableX, setPairVariableX] = useState('');
  const [pairVariableY, setPairVariableY] = useState('');
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
  const [showMarkers, setShowMarkers] = useState(false);
  const [normalizeDensity, setNormalizeDensity] = useState(false);
  const [cumulativeDensity, setCumulativeDensity] = useState(false);
  const [swarmOverlay, setSwarmOverlay] = useState(false);
  const [histogramBins, setHistogramBins] = useState(32);
  const [histogramStat, setHistogramStat] = useState<'count' | 'probability' | 'percent' | 'density'>('density');
  const [histogramMode, setHistogramMode] = useState<'overlay' | 'group' | 'stack'>('overlay');
  const [histogramElement, setHistogramElement] = useState<'bars' | 'step'>('bars');
  const [densityKind, setDensityKind] = useState<'heatmap' | 'contour'>('heatmap');
  const [missingPlotType, setMissingPlotType] = useState<'matrix' | 'bars' | 'heatmap'>('matrix');
  const [colorScale, setColorScale] = useState('Blues');
  const [regressionOrder, setRegressionOrder] = useState(1);
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [markerOpacity, setMarkerOpacity] = useState(0.78);
  const [markerSize, setMarkerSize] = useState(7);
  const [facetVariables, setFacetVariables] = useState(true);
  const [sameYAxis, setSameYAxis] = useState(false);
  const [facetColumns, setFacetColumns] = useState(2);
  const [variablesByScope, setVariablesByScope] = useState<Partial<Record<VariableSelectionScope, string[]>>>({});
  const [loadNotice, setLoadNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [useMultiByScope, setUseMultiByScope] = useState<Partial<Record<VariableSelectionScope, boolean>>>(() => {
    const defaults: Partial<Record<VariableSelectionScope, boolean>> = {};
    for (const scope of VARIABLE_SELECTION_SCOPES) {
      if (REFERENCE_MULTI_OUTPUT_SECTIONS.has(scope as LabSection)) {
        defaults[scope] = true;
      }
    }
    return defaults;
  });
  const { activeWorkspaceId } = useWorkspace();

  useEffect(() => {
    const loadWorkspaceDefaults = async () => {
      try {
        const response = await getAppConfig();
        const values = Object.fromEntries(response.items.map((item) => [item.key, item.value]));
        setRollingWindow(Math.max(0, Math.floor(values['workspace.default_rolling_window'] ?? 0)));
        setDecompositionWindow(Math.max(2, Math.floor(values['workspace.default_decomposition_window'] ?? 21)));
        setForecastHorizon(Math.max(1, Math.min(365, Math.floor(values['workspace.default_forecast_horizon'] ?? 30))));
        setChangepointWindow(Math.max(2, Math.floor(values['workspace.default_changepoint_window'] ?? 7)));
        setChangepointSensitivity(Number(values['workspace.default_changepoint_sensitivity'] ?? 2));
        setHistogramBins(Math.max(1, Math.floor(values['workspace.default_histogram_bins'] ?? 32)));
        setConfidenceLevel(Number(values['workspace.default_confidence_level'] ?? 0.95));
        setMarkerOpacity(Math.max(0.05, Math.min(1, Number(values['workspace.default_marker_opacity'] ?? 0.78))));
        setMarkerSize(Math.max(1, Math.floor(values['workspace.default_marker_size'] ?? 7)));
        setFacetColumns(Math.max(1, Math.floor(values['workspace.default_facet_columns'] ?? 2)));
      } catch {
        // Keep compiled defaults when configuration cannot be loaded.
      }
    };
    void loadWorkspaceDefaults();
  }, []);

  const selection = useMemo(
    () => ({
      selectedSourceIds,
      selectedManualDatasetId,
      selectedStations,
      dateFrom,
      dateTo,
      rowLimit,
      granularity,
      timeAggregation,
      plotViewport,
    }),
    [
      dateFrom,
      dateTo,
      granularity,
      timeAggregation,
      plotViewport,
      rowLimit,
      selectedManualDatasetId,
      selectedSourceIds,
      selectedStations,
    ],
  );

  const plotControls = useMemo(
    () => ({
      chartType,
      summaryChartType,
      correlationChartType,
      rollingWindow,
      seasonalityMode,
      decompositionWindow,
      profileMode,
      profileAggregation,
      profileHeatmapMode,
      forecastHorizon,
      changepointWindow,
      changepointSensitivity,
      trendDeseasonalized,
      pairVariableX,
      pairVariableY,
      genericXAxis,
      genericYAxis,
      genericHue,
      genericFacetRow,
      genericFacetCol,
      genericCategoryOrderInput,
      timeIsHere,
      showStdBand,
      showMarkers,
      normalizeDensity,
      cumulativeDensity,
      swarmOverlay,
      histogramBins,
      histogramStat,
      histogramMode,
      histogramElement,
      densityKind,
      missingPlotType,
      colorScale,
      regressionOrder,
      confidenceLevel,
      markerOpacity,
      markerSize,
      facetVariables,
      sameYAxis,
      facetColumns,
    }),
    [
      chartType,
      changepointSensitivity,
      changepointWindow,
      colorScale,
      correlationChartType,
      cumulativeDensity,
      confidenceLevel,
      densityKind,
      decompositionWindow,
      facetColumns,
      facetVariables,
      forecastHorizon,
      genericCategoryOrderInput,
      genericFacetCol,
      genericFacetRow,
      genericHue,
      genericXAxis,
      genericYAxis,
      histogramBins,
      histogramElement,
      histogramMode,
      histogramStat,
      markerOpacity,
      markerSize,
      missingPlotType,
      normalizeDensity,
      pairVariableX,
      pairVariableY,
      profileAggregation,
      profileHeatmapMode,
      profileMode,
      regressionOrder,
      rollingWindow,
      sameYAxis,
      seasonalityMode,
      showMarkers,
      showStdBand,
      summaryChartType,
      swarmOverlay,
      timeIsHere,
      trendDeseasonalized,
    ],
  );

  const bootstrapActions = useMemo(
    () => ({
      setDateFrom: (value: string) => setDateFrom(value),
      setDateTo: (value: string) => setDateTo(value),
      setSelectedSourceIds: (value: number[]) => setSelectedSourceIds(value),
      setRowLimit: (value: number) => setRowLimit(value),
      setRangePreset: (value: string) => setRangePreset(value),
      setPlotViewport: (value: { from: string | null; to: string | null }) => setPlotViewport(value),
    }),
    [
      setDateFrom,
      setDateTo,
      setPlotViewport,
      setRangePreset,
      setRowLimit,
      setSelectedSourceIds,
    ],
  );

  const getVariablesForScope = useCallback((scope: VariableSelectionScope, availableCodes: string[]) => {
    const current = variablesByScope[scope] ?? [];
    const cleaned = current.filter((code) => availableCodes.includes(code));
    return cleaned.length > 0 ? cleaned : getDefaultVariableSelection(scope, availableCodes);
  }, [variablesByScope]);

  const isMultiEnabledForScope = useCallback(
    (scope: VariableSelectionScope) => Boolean(useMultiByScope[scope]),
    [useMultiByScope],
  );

  const configuredScopeVariables = labSection === 'load-data' ? [] : (variablesByScope[labSection] ?? []);
  const requestedPlotVariableCodes = (() => {
    if (labSection === 'load-data') return [];
    if (labSection === 'scatter') {
      return configuredScopeVariables.slice(0, 2);
    }
    // Single-output sections always use one variable unless multi is explicitly on
    if (REFERENCE_SINGLE_OUTPUT_SECTIONS.has(labSection) && !isMultiEnabledForScope(labSection)) {
      return configuredScopeVariables.slice(0, 1);
    }
    // Correlation and multi-enabled scopes: send all variables
    if (isMultiEnabledForScope(labSection) || labSection === 'correlation') {
      return configuredScopeVariables;
    }
    return configuredScopeVariables.slice(0, 1);
  })();

  const controller = useAnalyticalWorkspaceController({
    activeWorkspaceId,
    labSection,
    selection,
    plotVariableCodes: requestedPlotVariableCodes,
    plotControls,
    bootstrapActions,
  });

  const {
    filters: controllerFilters,
    manualDatasets: controllerManualDatasets,
    rows: controllerRows,
    loading: controllerLoading,
    error: controllerError,
    plotLoading: controllerPlotLoading,
    plotError: controllerPlotError,
    plotResponse: controllerPlotResponse,
    bootstrapReady: controllerBootstrapReady,
    manualDatasetsLoading: controllerManualDatasetsLoading,
    runAnalysis: controllerRunAnalysis,
  } = controller;

  const visibleSources = useMemo(() => {
    if (!controllerFilters) {
      return [];
    }

    const keyword = sourceSearch.trim().toLowerCase();
    if (!keyword) {
      return controllerFilters.sources;
    }

    return controllerFilters.sources.filter((source) => {
      const haystack = `${source.name} ${source.source_type} ${source.etl_run_id}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [controllerFilters, sourceSearch]);

  const finalizedManualDatasets = useMemo(
    () =>
      controllerManualDatasets.filter((dataset) => dataset.status.startsWith('finalized')),
    [controllerManualDatasets],
  );

  const filteredManualDatasets = useMemo(() => {
    const keyword = sourceSearch.trim().toLowerCase();
    if (!keyword) {
      return finalizedManualDatasets;
    }
    return finalizedManualDatasets.filter((dataset) => {
      const haystack =
        `${dataset.name} ${dataset.original_file_name} ${dataset.source_kind} ${dataset.dataset_kind ?? ''}`
          .toLowerCase();
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
    if (!controllerFilters || selectedSourceIds.length === 0) {
      return [];
    }
    const selectedSet = new Set(selectedSourceIds);
    return controllerFilters.sources.filter((source) => selectedSet.has(source.id));
  }, [controllerFilters, selectedSourceIds]);

  const availableVariables = useMemo(() => {
    if (selectedManualDataset) {
      if (manualDatasetColumnOptions.length > 0) {
        const numericColumnNames = new Set(selectedManualDataset.summary.numeric_columns ?? []);
        const numericOptions = manualDatasetColumnOptions.filter(
          (column) => column.inferredKind === 'numeric' || numericColumnNames.has(column.code),
        );
        return numericOptions.length > 0 ? numericOptions : manualDatasetColumnOptions;
      }
      const grouped = new Map<string, string>();
      for (const row of controllerRows) {
        grouped.set(row.variable_code, row.variable_name || row.variable_code);
      }
      return Array.from(grouped.entries()).map(([code, name]) => ({ code, name }));
    }
    if (!controllerFilters) {
      return [];
    }
    if (selectedSources.length === 0) {
      return controllerFilters.variables;
    }
    const allowedCodes = new Set(selectedSources.flatMap((source) => source.variable_codes));
    return controllerFilters.variables.filter((variable) => allowedCodes.has(variable.code));
  }, [controllerFilters, controllerRows, manualDatasetColumnOptions, selectedManualDataset, selectedSources]);

  const availableVariableCodes = useMemo(
    () => availableVariables.map((variable) => variable.code),
    [availableVariables],
  );

  const activeRawSelectedVariables = useMemo(
    () => (labSection === 'load-data' ? [] : getVariablesForScope(labSection, availableVariableCodes)),
    [availableVariableCodes, getVariablesForScope, labSection],
  );

  const activeUseMulti = useMemo(
    () => {
      if (labSection === 'load-data') return false;
      return labSection === 'correlation' || labSection === 'scatter' || isMultiEnabledForScope(labSection);
    },
    [isMultiEnabledForScope, labSection],
  );

  const activeSelectedVariables = useMemo(
    () => {
      if (labSection === 'load-data') {
        return [];
      }
      return activeUseMulti ? activeRawSelectedVariables : activeRawSelectedVariables.slice(0, 1);
    },
    [activeRawSelectedVariables, activeUseMulti, labSection],
  );

  const advancedSelectedVariables = useMemo(
    () => (isMultiEnabledForScope('advanced')
      ? getVariablesForScope('advanced', availableVariableCodes)
      : getVariablesForScope('advanced', availableVariableCodes).slice(0, 1)),
    [availableVariableCodes, getVariablesForScope, isMultiEnabledForScope],
  );

  const availableStations = useMemo(() => {
    if (selectedManualDataset && !isMeasurementManualDataset) {
      return [];
    }
    if (selectedManualDatasetId && controllerRows.length > 0) {
      const grouped = new Map<string, string>();
      for (const row of controllerRows) {
        grouped.set(row.station_code, row.station_name || row.station_code);
      }
      return Array.from(grouped.entries()).map(([code, name]) => ({ code, name }));
    }
    return controllerFilters?.stations ?? [];
  }, [controllerFilters, controllerRows, isMeasurementManualDataset, selectedManualDataset, selectedManualDatasetId]);

  const sourceMaxRows = useMemo(
    () =>
      Math.max(
        100,
        selectedManualDataset
          ? selectedManualDataset.row_count || rowLimit
          : selectedSources.reduce((total, source) => total + source.row_count, 0) || rowLimit,
      ),
    [rowLimit, selectedManualDataset, selectedSources],
  );

  const summary = useMemo(() => buildLocalSummary(controllerRows), [controllerRows]);
  const selectedDateWindow = useMemo(() => normalizeDateRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const viewportBoundToRows = useMemo(
    () => isTimeNavigableSection(labSection) && Boolean(plotViewport.from ?? plotViewport.to),
    [labSection, plotViewport.from, plotViewport.to],
  );
  const effectiveRowWindow = useMemo(
    () => ({
      from: viewportBoundToRows ? plotViewport.from ?? selectedDateWindow.from ?? '' : selectedDateWindow.from ?? '',
      to: viewportBoundToRows ? plotViewport.to ?? selectedDateWindow.to ?? '' : selectedDateWindow.to ?? '',
    }),
    [plotViewport.from, plotViewport.to, selectedDateWindow.from, selectedDateWindow.to, viewportBoundToRows],
  );
  const pairVariableOptions = useMemo(
    () => (activeUseMulti && activeSelectedVariables.length > 0 ? activeSelectedVariables : availableVariableCodes),
    [activeSelectedVariables, activeUseMulti, availableVariableCodes],
  );

  useEffect(() => {
    setRowLimit((current) => Math.min(Math.max(100, current), sourceMaxRows));
  }, [setRowLimit, sourceMaxRows]);

  useEffect(() => {
    setLoadNotice(null);
  }, [dateFrom, dateTo, rowLimit, selectedManualDatasetId, selectedSourceIds, selectedStations]);

  useEffect(() => {
    if (!isGenericManualDataset) return;
    setUseMultiByScope((current) => {
      const allOn = VARIABLE_SELECTION_SCOPES.every((s) => Boolean(current[s]));
      if (allOn) return current;
      const next: Partial<Record<VariableSelectionScope, boolean>> = {};
      for (const scope of VARIABLE_SELECTION_SCOPES) {
        next[scope] = true;
      }
      return next;
    });
  }, [isGenericManualDataset]);

  useEffect(() => {
    if (!controllerBootstrapReady || availableVariableCodes.length === 0) {
      return;
    }

    setVariablesByScope((current) => {
      let changed = false;
      const next: Partial<Record<VariableSelectionScope, string[]>> = { ...current };

      for (const scope of VARIABLE_SELECTION_SCOPES) {
        const scoped = current[scope] ?? [];
        const cleaned = scoped.filter((code) => availableVariableCodes.includes(code));
        const target = cleaned.length > 0 ? cleaned : getDefaultVariableSelection(scope, availableVariableCodes);
        if (target.length !== scoped.length || target.some((code, index) => code !== scoped[index])) {
          next[scope] = target;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [availableVariableCodes, controllerBootstrapReady]);

  useEffect(() => {
    if ((labSection !== 'correlation' && labSection !== 'scatter') || pairVariableOptions.length === 0) {
      return;
    }

    if (!pairVariableOptions.includes(pairVariableX)) {
      setPairVariableX(pairVariableOptions[0] ?? '');
    }

    if (!pairVariableOptions.includes(pairVariableY) || pairVariableY === pairVariableX) {
      const fallback =
        pairVariableOptions.find((value) => value !== (pairVariableOptions[0] ?? ''))
        ?? pairVariableOptions[0]
        ?? '';
      if (pairVariableY !== fallback) {
        setPairVariableY(fallback);
      }
    }
  }, [labSection, pairVariableOptions, pairVariableX, pairVariableY]);

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
    setGenericYAxis((current) => (current && allColumns.includes(current) ? current : numericColumns[0] ?? ''));
    setGenericHue((current) => (current && allColumns.includes(current) ? current : categoricalColumns[0] ?? ''));
    setGenericFacetRow((current) => (current && allColumns.includes(current) ? current : ''));
    setGenericFacetCol((current) => (current && allColumns.includes(current) ? current : ''));
  }, [selectedManualDataset]);

  const applyRangePreset = (presetId: string) => {
    if (!controllerFilters) {
      return;
    }

    const minDate = toIsoDate(controllerFilters.min_observed_at);
    const maxDate = toIsoDate(controllerFilters.max_observed_at);
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

  const handleRunClick = async () => {
    setLoadNotice(null);
    if (selectedSourceIds.length === 0 && !selectedManualDatasetId) {
      setLoadNotice({ tone: 'error', message: 'Selecciona al menos una fuente o dataset antes de cargar.' });
      return;
    }

    const sourceLabel = selectedManualDataset
      ? selectedManualDataset.name
      : selectedSources.length === 1
        ? selectedSources[0].name
        : `${selectedSources.length} fuentes`;

    if (isGenericManualDataset) {
      setLoadNotice({
        tone: 'success',
        message: `Informacion lista: ${sourceLabel} (${selectedManualDataset.row_count.toLocaleString()} filas).`,
      });
      setWorkspaceMode('exploration');
      setLabSection('summary');
      return;
    }

    const result = await controllerRunAnalysis();
    if (!result.ok) {
      setLoadNotice({ tone: 'error', message: result.message });
      return;
    }
    setLoadNotice({
      tone: 'success',
      message: `Informacion cargada correctamente: ${sourceLabel} (${result.rowsLoaded.toLocaleString()} filas).`,
    });
    setWorkspaceMode('exploration');
    setLabSection('summary');
  };

  const handleVariableMappingChange = (slot: 'x' | 'y' | 'fill' | 'color' | 'size' | 'group' | 'facet', value: string) => {
    if (slot === 'x') {
      setGenericXAxis(value);
      return;
    }
    if (slot === 'y') {
      setGenericYAxis(value);
      return;
    }
    if (slot === 'color') {
      setGenericHue(value);
      return;
    }
    if (slot === 'facet') {
      setGenericFacetCol(value);
    }
  };

  const handleToggleStation = (stationCode: string) => {
    setSelectedStations((current) => {
      if (current.includes(stationCode)) {
        return current.filter((item) => item !== stationCode);
      }
      return [...current, stationCode];
    });
  };

  const handleToggleVariableForScope = (scope: VariableSelectionScope, variableCode: string) => {
    setVariablesByScope((current) => {
      const scoped = current[scope] ?? getDefaultVariableSelection(scope, availableVariableCodes);
      const next = scoped.includes(variableCode)
        ? (scoped.length > 1 ? scoped.filter((item) => item !== variableCode) : scoped)
        : [...scoped, variableCode];

      if (next.length === scoped.length && next.every((code, index) => code === scoped[index])) {
        return current;
      }

      return {
        ...current,
        [scope]: next,
      };
    });
  };

  const handleSetSingleVariableForScope = (scope: VariableSelectionScope, variableCode: string) => {
    setVariablesByScope((current) => ({
      ...current,
      [scope]: [variableCode],
    }));
  };

  const handleUseMultiForScope = (scope: VariableSelectionScope, enabled: boolean) => {
    setUseMultiByScope((current) => ({
      ...current,
      [scope]: enabled,
    }));
    if (!enabled) {
      setVariablesByScope((current) => {
        const scoped = current[scope] ?? [];
        return {
          ...current,
          [scope]: scoped.slice(0, 1),
        };
      });
    }
  };

  const handleToggleActiveSectionVariable = (variableCode: string) => {
    if (labSection === 'load-data') {
      return;
    }
    handleToggleVariableForScope(labSection, variableCode);
  };

  const handleSelectActiveSectionSingleVariable = (variableCode: string) => {
    if (labSection === 'load-data') {
      return;
    }
    handleSetSingleVariableForScope(labSection, variableCode);
  };

  const handleToggleAdvancedVariable = (variableCode: string) => {
    handleToggleVariableForScope('advanced', variableCode);
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
    const isDeselecting = selectedManualDatasetId === datasetId;
    setSelectedSourceIds([]);
    setSelectedManualDatasetId(isDeselecting ? null : datasetId);
    setSelectedStations([]);
    setDateFrom('');
    setDateTo('');
    setRangePreset('all');

    if (!isDeselecting) {
      const dataset = controllerManualDatasets.find((d) => d.id === datasetId);
      if (dataset?.dataset_kind === 'generic') {
        setUseMultiByScope((current) => {
          const next = { ...current };
          for (const scope of VARIABLE_SELECTION_SCOPES) {
            next[scope] = true;
          }
          return next;
        });
      }
    }
  };

  const activeSection = ANALYSIS_SECTIONS.find((section) => section.value === labSection) ?? ANALYSIS_SECTIONS[0];
  const ActiveSectionIcon = activeSection.icon;
  const isDescriptiveSection = DESCRIPTIVE_ANALYTICS_SECTIONS.includes(labSection);
  const descriptiveSections = ANALYSIS_SECTIONS.filter((section) =>
    DESCRIPTIVE_ANALYTICS_SECTIONS.includes(section.value),
  );
  const activeSelectedVariableLabels = activeSelectedVariables.map(
    (code) => availableVariables.find((variable) => variable.code === code)?.name ?? code,
  );
  const advancedSelectedVariableLabels = advancedSelectedVariables.map(
    (code) => availableVariables.find((variable) => variable.code === code)?.name ?? code,
  );
  const displayedSelectedVariableLabels =
    workspaceMode === 'advanced' ? advancedSelectedVariableLabels : activeSelectedVariableLabels;
  const selectedDataSourceCount = selectedSourceIds.length + (selectedManualDatasetId ? 1 : 0);
  const plotStats = controllerPlotResponse?.stats ?? {};
  const plotWarnings = controllerPlotResponse?.warnings ?? [];
  const plotDataFrameSummary = Array.isArray(plotStats.data_frame_summary)
    ? (plotStats.data_frame_summary as Record<string, unknown>[])
    : [];
  const plotVariableSummary = Array.isArray(plotStats.variable_summary)
    ? (plotStats.variable_summary as Record<string, unknown>[])
    : [];
  const plotQualitySummary = Array.isArray(plotStats.quality_summary)
    ? (plotStats.quality_summary as Record<string, unknown>[])
    : [];
  const statSamples = typeof plotStats.samples === 'number' ? Number(plotStats.samples) : summary.samples;
  const statMean = typeof plotStats.mean === 'number' ? Number(plotStats.mean) : summary.mean;
  const statTrend = typeof plotStats.trend === 'string' ? plotStats.trend : summary.trend;
  const canUseGenericAxes = isGenericManualDataset && manualDatasetColumnOptions.length > 0;
  const currentInlinePlotType =
    labSection === 'rolling' || labSection === 'data_trend'
      ? chartType
      : labSection === 'summary' || labSection === 'distribution'
        ? summaryChartType
        : correlationChartType;
  const supportsInlinePlotControls =
    labSection === 'summary'
    || labSection === 'distribution'
    || labSection === 'correlation'
    || labSection === 'scatter'
    || ((labSection === 'rolling' || labSection === 'data_trend') && canUseGenericAxes);
  const hasInlinePlotControls =
    supportsInlinePlotControls
    || ((labSection === 'rolling' || labSection === 'data_trend') && currentInlinePlotType === 'line');

  const renderAnalysisChart = () => {
    if (controllerPlotLoading && controllerPlotResponse) {
      return (
        <div className="relative h-full">
          <PlotlyFigurePanel
            figure={controllerPlotResponse.figure_json}
            title={activeSection.label}
            description={getLabSectionDescription(labSection)}
            height={isDescriptiveSection ? 660 : 560}
            enableTimeNavigation={isTimeNavigableSection(labSection)}
            uirevision={`eda-${labSection}`}
          />
          <div className="absolute right-4 top-4 rounded-md border border-[#dce5f1] bg-white/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
            Updating
          </div>
        </div>
      );
    }

    if (controllerPlotLoading) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-white">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Building Plotly figure...
        </div>
      );
    }

    if (controllerPlotError) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-white px-6 text-center">
          {controllerPlotError}
        </div>
      );
    }

    if (!controllerPlotResponse) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-white">
          Load data from the source section before opening this analysis.
        </div>
      );
    }

    return (
      <PlotlyFigurePanel
        figure={controllerPlotResponse.figure_json}
        title={activeSection.label}
        description={getLabSectionDescription(labSection)}
        height={isDescriptiveSection ? 660 : 560}
        enableTimeNavigation={isTimeNavigableSection(labSection)}
        uirevision={`eda-${labSection}`}
      />
    );
  };

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-[#F9FBFC]">
      {workspaceMode === 'exploration' && (
        <AnalyticalWorkspaceSidebar
          collapsed={sidebarCollapsed}
          labSection={labSection}
          selectedDataSourceCount={selectedDataSourceCount}
          availableVariables={availableVariables}
          selectedVariables={activeSelectedVariables}
          selectedStationsCount={selectedStations.length}
          rowCount={controllerRows.length}
          viewportBoundToRows={viewportBoundToRows}
          onSelectSection={setLabSection}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        />
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
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
              {labSection !== 'load-data' && (
                <Badge variant="outline">
                  {displayedSelectedVariableLabels.join(', ') || 'Select variables'}
                </Badge>
              )}
            </div>
          </div>

          <Tabs value={workspaceMode} onValueChange={(value) => setWorkspaceMode(value as 'exploration' | 'advanced')}>
            <TabsList className="bg-white border border-[#dce5f1] p-1 h-auto">
              <TabsTrigger value="exploration" className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white">
                Exploration
              </TabsTrigger>
              <TabsTrigger value="advanced" className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white">
                Advanced Analytics
              </TabsTrigger>
            </TabsList>

            {controllerError && (
              <Card className="bg-white border-l-4 border-l-[#509EE3]">
                <CardContent className="py-3">
                  <p className="text-sm text-[#1F5A8A]">{controllerError}</p>
                </CardContent>
              </Card>
            )}

            {loadNotice && (
              <Card
                className={`bg-white border-l-4 ${
                  loadNotice.tone === 'success' ? 'border-l-emerald-500' : 'border-l-red-500'
                }`}
              >
                <CardContent className="py-3">
                  <div
                    className={`flex items-center gap-2 text-sm ${
                      loadNotice.tone === 'success' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {loadNotice.tone === 'success' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    <span>{loadNotice.message}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <TabsContent value="exploration" className="space-y-6">
              {labSection === 'load-data' ? (
                <AnalyticalWorkspaceLoadDataPanel
                  filteredSources={visibleSources}
                  filteredManualDatasets={filteredManualDatasets}
                  manualDatasetsLoading={controllerManualDatasetsLoading}
                  availableStations={availableStations}
                  sourceMaxRows={sourceMaxRows}
                  loading={controllerLoading}
                  viewportBoundToRows={viewportBoundToRows}
                  effectiveRowWindow={effectiveRowWindow}
                  selectedManualDatasetKind={selectedManualDataset?.dataset_kind ?? null}
                  onToggleSource={handleToggleSource}
                  onSelectManualDataset={handleSelectManualDataset}
                  onToggleStation={handleToggleStation}
                  onApplyRangePreset={applyRangePreset}
                  onRun={() => void handleRunClick()}
                />
              ) : (
                <div className="space-y-6">
                  <div className="rounded-lg border border-[#dce5f1] bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {descriptiveSections.map((section) => {
                        const Icon = section.icon;
                        const active = labSection === section.value;
                        return (
                          <button
                            key={`descriptive-tab-${section.value}`}
                            type="button"
                            onClick={() => setLabSection(section.value)}
                            className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors ${
                              active
                                ? 'bg-[#24384d] text-white shadow-sm'
                                : 'text-[#008c7a] hover:bg-[#eef6ff] hover:text-[#1F5A8A]'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {section.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

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
                      <CardDescription>{getLabSectionDescription(labSection)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <AnalyticalWorkspaceSectionControls
                        labSection={labSection}
                        granularity={granularity}
                        timeAggregation={timeAggregation}
                        chartType={chartType}
                        rollingWindow={rollingWindow}
                        seasonalityMode={seasonalityMode}
                        decompositionWindow={decompositionWindow}
                        profileMode={profileMode}
                        profileAggregation={profileAggregation}
                        profileHeatmapMode={profileHeatmapMode}
                        forecastHorizon={forecastHorizon}
                        changepointWindow={changepointWindow}
                        changepointSensitivity={changepointSensitivity}
                        trendDeseasonalized={trendDeseasonalized}
                        pairVariableX={pairVariableX}
                        pairVariableY={pairVariableY}
                        pairVariableOptions={pairVariableOptions}
                        isGenericManualDataset={isGenericManualDataset}
                        onGranularityChange={setGranularity}
                        onTimeAggregationChange={setTimeAggregation}
                        onChartTypeChange={setChartType}
                        onRollingWindowChange={setRollingWindow}
                        onSeasonalityModeChange={setSeasonalityMode}
                        onDecompositionWindowChange={setDecompositionWindow}
                        onProfileModeChange={setProfileMode}
                        onProfileAggregationChange={setProfileAggregation}
                        onProfileHeatmapModeChange={setProfileHeatmapMode}
                        onForecastHorizonChange={setForecastHorizon}
                        onChangepointWindowChange={setChangepointWindow}
                        onChangepointSensitivityChange={setChangepointSensitivity}
                        onToggleTrendDeseasonalized={() => setTrendDeseasonalized((current) => !current)}
                        onPairVariableXChange={setPairVariableX}
                        onPairVariableYChange={setPairVariableY}
                      />
                      <div className="mb-4 space-y-3">
                        <AnalyticalWorkspaceVariableSelector
                          availableVariables={availableVariables}
                          selectedVariables={activeSelectedVariables}
                          useMulti={activeUseMulti}
                          title="Variables"
                          multiToggleDisabled={labSection === 'correlation' || labSection === 'scatter'}
                          mappingValues={{
                            x: genericXAxis,
                            y: genericYAxis,
                            color: genericHue,
                            facet: genericFacetCol,
                          }}
                          onMappingChange={handleVariableMappingChange}
                          onUseMultiChange={(value) => handleUseMultiForScope(labSection, value)}
                          onSelectSingle={handleSelectActiveSectionSingleVariable}
                          onToggleVariable={handleToggleActiveSectionVariable}
                        />
                      </div>
                      {isDescriptiveSection && hasInlinePlotControls && (
                        <div className="mb-4">
                          <AnalyticalWorkspaceInlinePlotControls
                            labSection={labSection}
                            isGenericManualDataset={isGenericManualDataset}
                            manualDatasetColumnOptions={manualDatasetColumnOptions}
                            layout="strip"
                            chartType={chartType}
                            summaryChartType={summaryChartType}
                            correlationChartType={correlationChartType}
                            useMultiVariables={activeUseMulti}
                            genericXAxis={genericXAxis}
                            genericYAxis={genericYAxis}
                            genericHue={genericHue}
                            genericFacetRow={genericFacetRow}
                            genericFacetCol={genericFacetCol}
                            genericCategoryOrderInput={genericCategoryOrderInput}
                            timeIsHere={timeIsHere}
                            showStdBand={showStdBand}
                            showMarkers={showMarkers}
                            normalizeDensity={normalizeDensity}
                            cumulativeDensity={cumulativeDensity}
                            swarmOverlay={swarmOverlay}
                            histogramBins={histogramBins}
                            histogramStat={histogramStat}
                            histogramMode={histogramMode}
                            histogramElement={histogramElement}
                            densityKind={densityKind}
                            missingPlotType={missingPlotType}
                            colorScale={colorScale}
                            regressionOrder={regressionOrder}
                            confidenceLevel={confidenceLevel}
                            markerOpacity={markerOpacity}
                            markerSize={markerSize}
                            facetVariables={facetVariables}
                            sameYAxis={sameYAxis}
                            facetColumns={facetColumns}
                            onSummaryChartTypeChange={setSummaryChartType}
                            onCorrelationChartTypeChange={setCorrelationChartType}
                            onGenericXAxisChange={setGenericXAxis}
                            onGenericYAxisChange={setGenericYAxis}
                            onGenericHueChange={setGenericHue}
                            onGenericFacetRowChange={setGenericFacetRow}
                            onGenericFacetColChange={setGenericFacetCol}
                            onGenericCategoryOrderInputChange={setGenericCategoryOrderInput}
                            onToggleTimeIsHere={() => setTimeIsHere((current) => !current)}
                            onToggleShowStdBand={() => setShowStdBand((current) => !current)}
                            onToggleShowMarkers={() => setShowMarkers((current) => !current)}
                            onToggleNormalizeDensity={() => setNormalizeDensity((current) => !current)}
                            onToggleCumulativeDensity={() => setCumulativeDensity((current) => !current)}
                            onToggleSwarmOverlay={() => setSwarmOverlay((current) => !current)}
                            onHistogramBinsChange={setHistogramBins}
                            onHistogramStatChange={setHistogramStat}
                            onHistogramModeChange={setHistogramMode}
                            onHistogramElementChange={setHistogramElement}
                            onDensityKindChange={setDensityKind}
                            onMissingPlotTypeChange={setMissingPlotType}
                            onColorScaleChange={setColorScale}
                            onRegressionOrderChange={setRegressionOrder}
                            onConfidenceLevelChange={setConfidenceLevel}
                            onMarkerOpacityChange={setMarkerOpacity}
                            onMarkerSizeChange={setMarkerSize}
                            onToggleFacetVariables={() => setFacetVariables((current) => !current)}
                            onToggleSameYAxis={() => setSameYAxis((current) => !current)}
                            onFacetColumnsChange={setFacetColumns}
                          />
                        </div>
                      )}
                      <div className={isDescriptiveSection ? 'space-y-4' : 'flex flex-col xl:flex-row gap-4'}>
                        <div className="flex-1 min-w-0">
                          <div className={`${isDescriptiveSection ? 'h-[680px]' : 'h-[560px]'} w-full`}>
                            {renderAnalysisChart()}
                          </div>
                        </div>
                        {!isDescriptiveSection && hasInlinePlotControls && (
                          <div className="w-full xl:w-[320px] shrink-0">
                            <AnalyticalWorkspaceInlinePlotControls
                              labSection={labSection}
                              isGenericManualDataset={isGenericManualDataset}
                              manualDatasetColumnOptions={manualDatasetColumnOptions}
                              chartType={chartType}
                              summaryChartType={summaryChartType}
                              correlationChartType={correlationChartType}
                              useMultiVariables={activeUseMulti}
                              genericXAxis={genericXAxis}
                              genericYAxis={genericYAxis}
                              genericHue={genericHue}
                              genericFacetRow={genericFacetRow}
                              genericFacetCol={genericFacetCol}
                              genericCategoryOrderInput={genericCategoryOrderInput}
                              timeIsHere={timeIsHere}
                              showStdBand={showStdBand}
                              showMarkers={showMarkers}
                              normalizeDensity={normalizeDensity}
                              cumulativeDensity={cumulativeDensity}
                              swarmOverlay={swarmOverlay}
                              histogramBins={histogramBins}
                              histogramStat={histogramStat}
                              histogramMode={histogramMode}
                              histogramElement={histogramElement}
                              densityKind={densityKind}
                              missingPlotType={missingPlotType}
                              colorScale={colorScale}
                              regressionOrder={regressionOrder}
                              confidenceLevel={confidenceLevel}
                              markerOpacity={markerOpacity}
                              markerSize={markerSize}
                              facetVariables={facetVariables}
                              sameYAxis={sameYAxis}
                              facetColumns={facetColumns}
                              onSummaryChartTypeChange={setSummaryChartType}
                              onCorrelationChartTypeChange={setCorrelationChartType}
                              onGenericXAxisChange={setGenericXAxis}
                              onGenericYAxisChange={setGenericYAxis}
                              onGenericHueChange={setGenericHue}
                              onGenericFacetRowChange={setGenericFacetRow}
                              onGenericFacetColChange={setGenericFacetCol}
                              onGenericCategoryOrderInputChange={setGenericCategoryOrderInput}
                              onToggleTimeIsHere={() => setTimeIsHere((current) => !current)}
                              onToggleShowStdBand={() => setShowStdBand((current) => !current)}
                              onToggleShowMarkers={() => setShowMarkers((current) => !current)}
                              onToggleNormalizeDensity={() => setNormalizeDensity((current) => !current)}
                              onToggleCumulativeDensity={() => setCumulativeDensity((current) => !current)}
                              onToggleSwarmOverlay={() => setSwarmOverlay((current) => !current)}
                              onHistogramBinsChange={setHistogramBins}
                              onHistogramStatChange={setHistogramStat}
                              onHistogramModeChange={setHistogramMode}
                              onHistogramElementChange={setHistogramElement}
                              onDensityKindChange={setDensityKind}
                              onMissingPlotTypeChange={setMissingPlotType}
                              onColorScaleChange={setColorScale}
                              onRegressionOrderChange={setRegressionOrder}
                              onConfidenceLevelChange={setConfidenceLevel}
                              onMarkerOpacityChange={setMarkerOpacity}
                              onMarkerSizeChange={setMarkerSize}
                              onToggleFacetVariables={() => setFacetVariables((current) => !current)}
                              onToggleSameYAxis={() => setSameYAxis((current) => !current)}
                              onFacetColumnsChange={setFacetColumns}
                            />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <AnalyticalWorkspaceSecondaryContent
                    labSection={labSection}
                    plotResponse={controllerPlotResponse}
                    plotStats={plotStats}
                    plotDataFrameSummary={plotDataFrameSummary}
                    plotVariableSummary={plotVariableSummary}
                    plotQualitySummary={plotQualitySummary}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="advanced">
              <AnalyticalWorkspaceAdvancedPanel
                selectedDataSourceCount={selectedDataSourceCount}
                selectedVariableLabels={advancedSelectedVariableLabels}
                selectedVariables={advancedSelectedVariables}
                availableVariables={availableVariables}
                effectiveRowWindow={effectiveRowWindow}
                isGenericManualDataset={isGenericManualDataset}
                manualDatasetColumnOptions={manualDatasetColumnOptions}
                genericXAxis={genericXAxis}
                genericYAxis={genericYAxis}
                defaultForecastHorizon={forecastHorizon}
                onToggleVariable={handleToggleAdvancedVariable}
                onGenericXAxisChange={setGenericXAxis}
                onGenericYAxisChange={setGenericYAxis}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
