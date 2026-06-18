import { useCallback, useEffect, useRef, useState } from 'react';

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
import type { PlotViewport } from '@/features/analysis/contexts/analytical-workspace-context';
import {
  normalizeDateRange,
  toIsoDate,
  type AggregationMode,
  type ChartType,
  type HeatmapProfileMode,
  type LabSection,
  type ProfileMode,
  type TimeAggregationMode,
  type TimeGranularity,
} from '@/features/analysis/lib/analytical-workspace-config';

interface SharedSelectionState {
  selectedSourceIds: number[];
  selectedManualDatasetId: string | null;
  selectedStations: string[];
  dateFrom: string;
  dateTo: string;
  rowLimit: number;
  granularity: TimeGranularity;
  timeAggregation: TimeAggregationMode;
  plotViewport: PlotViewport;
}

interface PlotControlState {
  chartType: ChartType;
  summaryChartType: EdaChartType;
  correlationChartType: EdaChartType;
  rollingWindow: number;
  seasonalityMode: 'weekday' | 'month' | 'hour';
  decompositionWindow: number;
  profileMode: ProfileMode;
  profileAggregation: AggregationMode;
  profileHeatmapMode: HeatmapProfileMode;
  forecastHorizon: number;
  changepointWindow: number;
  changepointSensitivity: number;
  trendDeseasonalized: boolean;
  pairVariableX: string;
  pairVariableY: string;
  genericXAxis: string;
  genericYAxis: string;
  genericHue: string;
  genericFacetRow: string;
  genericFacetCol: string;
  genericCategoryOrderInput: string;
  timeIsHere: boolean;
  showStdBand: boolean;
  showMarkers: boolean;
  normalizeDensity: boolean;
  cumulativeDensity: boolean;
  swarmOverlay: boolean;
  histogramBins: number;
  histogramStat: 'count' | 'probability' | 'percent' | 'density';
  histogramMode: 'overlay' | 'group' | 'stack';
  histogramElement: 'bars' | 'step';
  densityKind: 'heatmap' | 'contour';
  missingPlotType: 'matrix' | 'bars' | 'heatmap';
  colorScale: string;
  regressionOrder: number;
  confidenceLevel: number;
  markerOpacity: number;
  markerSize: number;
  facetVariables: boolean;
  sameYAxis: boolean;
  facetColumns: number;
}

interface BootstrapActions {
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setSelectedSourceIds: (value: number[]) => void;
  setRowLimit: (value: number) => void;
  setRangePreset: (value: string) => void;
  setPlotViewport: (value: PlotViewport) => void;
}

interface UseAnalyticalWorkspaceControllerParams {
  activeWorkspaceId: string | null;
  labSection: LabSection;
  selection: SharedSelectionState;
  plotVariableCodes: string[];
  plotControls: PlotControlState;
  bootstrapActions: BootstrapActions;
}

interface RunAnalysisResult {
  ok: boolean;
  rowsLoaded: number;
  message: string;
}

export function useAnalyticalWorkspaceController({
  activeWorkspaceId,
  labSection,
  selection,
  plotVariableCodes,
  plotControls,
  bootstrapActions,
}: UseAnalyticalWorkspaceControllerParams) {
  const {
    selectedSourceIds,
    selectedManualDatasetId,
    selectedStations,
    dateFrom,
    dateTo,
    rowLimit,
    granularity,
    timeAggregation,
    plotViewport,
  } = selection;
  const [filters, setFilters] = useState<AnalyticsFilterOptionsResponse | null>(null);
  const [manualDatasets, setManualDatasets] = useState<ManualDatasetResponse[]>([]);
  const [rows, setRows] = useState<AnalyticsDataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plotLoading, setPlotLoading] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [plotResponse, setPlotResponse] = useState<EdaPlotResponse | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [manualDatasetsLoading, setManualDatasetsLoading] = useState(false);

  const requestIdRef = useRef(0);
  const plotRequestIdRef = useRef(0);
  const plotCacheRef = useRef<Map<string, EdaPlotResponse>>(new Map());

  const runAnalysis = useCallback(async (): Promise<RunAnalysisResult> => {
    const selectedManualDataset =
      manualDatasets.find((dataset) => dataset.id === selectedManualDatasetId) ?? null;
    const isMeasurementManualDataset = selectedManualDataset?.dataset_kind === 'measurements';

    if (selectedSourceIds.length === 0 && !selectedManualDatasetId) {
      setRows([]);
      const message = 'Select at least one data source to visualize.';
      setError(message);
      return { ok: false, rowsLoaded: 0, message };
    }

    if (selectedManualDatasetId && !isMeasurementManualDataset) {
      setRows([]);
      setError(null);
      return {
        ok: true,
        rowsLoaded: selectedManualDataset?.row_count ?? 0,
        message: 'Dataset is ready for Plotly summary rendering.',
      };
    }

    const selectedSet = new Set(selectedSourceIds);
    const datasetMaxRows = selectedManualDatasetId
      ? Math.max(100, selectedManualDataset?.row_count ?? rowLimit)
      : Math.max(
          100,
          filters?.sources
            .filter((source) => selectedSet.has(source.id))
            .reduce((total, source) => total + source.row_count, 0) ?? rowLimit,
        );
    const effectiveLimit = Math.max(100, Math.min(rowLimit, datasetMaxRows));
    const normalizedRange = normalizeDateRange(dateFrom, dateTo);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);
    try {
      const response = selectedManualDatasetId
        ? await getManualDatasetAnalyticsPreview(selectedManualDatasetId, {
            station_codes: selectedStations.length > 0 ? selectedStations : undefined,
            date_from: normalizedRange.from,
            date_to: normalizedRange.to,
            limit: effectiveLimit,
          })
        : await runAnalyticsQuery({
            source_file_ids: selectedSourceIds,
            station_codes: selectedStations.length > 0 ? selectedStations : undefined,
            date_from: normalizedRange.from,
            date_to: normalizedRange.to,
            limit: effectiveLimit,
          } satisfies AnalyticsQueryRequest);

      if (requestId !== requestIdRef.current) {
        return { ok: false, rowsLoaded: 0, message: 'A newer data request replaced this one.' };
      }

      setRows(response.rows);
      if (response.rows.length === 0) {
        const message = 'No data for the selected source selection and filters.';
        setError(message);
        return { ok: false, rowsLoaded: 0, message };
      }
      return {
        ok: true,
        rowsLoaded: response.rows.length,
        message: `Loaded ${response.rows.length.toLocaleString()} rows.`,
      };
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return { ok: false, rowsLoaded: 0, message: 'A newer data request replaced this one.' };
      }
      setRows([]);
      let message: string;
      if (err instanceof Error && err.message === 'Failed to fetch') {
        message = 'No se pudo conectar con el backend. Verifica que la API este corriendo en http://localhost:8000.';
      } else {
        message = err instanceof Error ? err.message : 'Failed to load analytics data.';
      }
      setError(message);
      return { ok: false, rowsLoaded: 0, message };
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [dateFrom, dateTo, filters, manualDatasets, rowLimit, selectedManualDatasetId, selectedSourceIds, selectedStations]);

  const runPlotRequest = useCallback(async () => {
    const selectedDataSourceCount = selectedSourceIds.length + (selectedManualDatasetId ? 1 : 0);

    if (labSection === 'load-data' || selectedDataSourceCount === 0) {
      setPlotResponse(null);
      setPlotError(null);
      return;
    }

    const requestId = plotRequestIdRef.current + 1;
    plotRequestIdRef.current = requestId;
    const normalizedRange = normalizeDateRange(dateFrom, dateTo);
    const selectedManualDataset =
      manualDatasets.find((dataset) => dataset.id === selectedManualDatasetId) ?? null;
    const usesGenericEngine = selectedManualDataset?.dataset_kind === 'generic';
    const usesMeasurementEngine = !usesGenericEngine;
    const sanitizeChartType = (candidate: EdaChartType | null): EdaChartType | null => {
      if (!usesMeasurementEngine || candidate === null) {
        return candidate;
      }
      if (labSection === 'summary') {
        return ['bar', 'histogram', 'kde', 'box', 'violin'].includes(candidate) ? candidate : 'bar';
      }
      if (labSection === 'distribution') {
        return ['histogram', 'kde', 'box', 'violin'].includes(candidate) ? candidate : 'histogram';
      }
      if (labSection === 'correlation' || labSection === 'scatter') {
        return ['heatmap', 'scatter', 'regression'].includes(candidate)
          ? candidate
          : labSection === 'scatter'
            ? 'scatter'
            : 'heatmap';
      }
      return candidate;
    };
    const chartTypeForSection =
      labSection === 'rolling' || labSection === 'data_trend'
        ? plotControls.chartType
        : labSection === 'summary' || labSection === 'distribution'
          ? plotControls.summaryChartType
          : labSection === 'correlation' || labSection === 'scatter'
            ? plotControls.correlationChartType
            : null;
    const safeChartTypeForSection = sanitizeChartType(chartTypeForSection);
    const supportsGenericMappings =
      labSection === 'summary'
      || labSection === 'distribution'
      || labSection === 'correlation'
      || labSection === 'scatter'
      || labSection === 'rolling'
      || labSection === 'data_trend'
      || labSection === 'time_profiles'
      || labSection === 'profiles'
      || labSection === 'heat_map'
      || labSection === 'seasonality'
      || labSection === 'anomaly'
      || labSection === 'decomposition'
      || labSection === 'autocorr'
      || labSection === 'pacf'
      || labSection === 'forecast'
      || labSection === 'changepoints'
      || labSection === 'trend';
    const supportsDistributionOptions = labSection === 'summary' || labSection === 'distribution';
    const supportsRelationshipOptions = labSection === 'correlation' || labSection === 'scatter';
    const supportsTimeSeriesOptions =
      labSection === 'rolling'
      || labSection === 'data_trend'
      || labSection === 'time_profiles'
      || labSection === 'profiles'
      || labSection === 'heat_map'
      || labSection === 'seasonality'
      || labSection === 'anomaly'
      || labSection === 'decomposition'
      || labSection === 'autocorr'
      || labSection === 'pacf'
      || labSection === 'forecast'
      || labSection === 'changepoints'
      || labSection === 'trend';

    setPlotLoading(true);
    setPlotError(null);
    try {
      const payload = {
        section: labSection,
        source_file_ids: selectedSourceIds,
        manual_dataset_id: selectedManualDatasetId,
        station_codes: selectedStations,
        variable_codes: plotVariableCodes,
        date_from: normalizedRange.from ?? undefined,
        date_to: normalizedRange.to ?? undefined,
        limit: rowLimit,
        granularity,
        time_aggregation: timeAggregation,
        chart_type: safeChartTypeForSection,
        rolling_window: plotControls.rollingWindow,
        decomposition_window: plotControls.decompositionWindow,
        forecast_horizon: plotControls.forecastHorizon,
        changepoint_window: plotControls.changepointWindow,
        changepoint_sensitivity: plotControls.changepointSensitivity,
        profile_mode: labSection === 'seasonality' ? plotControls.seasonalityMode : plotControls.profileMode,
        profile_aggregation: plotControls.profileAggregation,
        profile_heatmap_mode: plotControls.profileHeatmapMode,
        trend_deseasonalized: plotControls.trendDeseasonalized,
        pair_variable_x: plotControls.pairVariableX || undefined,
        pair_variable_y: plotControls.pairVariableY || undefined,
        x_axis: supportsGenericMappings ? plotControls.genericXAxis || undefined : undefined,
        y_axis: supportsGenericMappings ? plotControls.genericYAxis || undefined : undefined,
        hue: supportsGenericMappings ? plotControls.genericHue || undefined : undefined,
        facet_row: supportsGenericMappings ? plotControls.genericFacetRow || undefined : undefined,
        facet_col: supportsGenericMappings ? plotControls.genericFacetCol || undefined : undefined,
        category_order: supportsGenericMappings
          ? plotControls.genericCategoryOrderInput
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        time_is_here: supportsTimeSeriesOptions ? plotControls.timeIsHere : true,
        show_std_band: supportsTimeSeriesOptions ? plotControls.showStdBand : false,
        show_markers: supportsTimeSeriesOptions || supportsDistributionOptions
          ? plotControls.showMarkers
          : false,
        cumulative: supportsDistributionOptions ? plotControls.cumulativeDensity : false,
        normalize_density: supportsDistributionOptions ? plotControls.normalizeDensity : false,
        swarm_overlay: supportsDistributionOptions ? plotControls.swarmOverlay : false,
        histogram_bins: supportsDistributionOptions ? plotControls.histogramBins : 32,
        histogram_stat: supportsDistributionOptions ? plotControls.histogramStat : 'count',
        histogram_mode: supportsDistributionOptions ? plotControls.histogramMode : 'overlay',
        histogram_element: supportsDistributionOptions ? plotControls.histogramElement : 'bars',
        density_kind: supportsDistributionOptions || supportsRelationshipOptions ? plotControls.densityKind : 'heatmap',
        missing_plot_type: supportsDistributionOptions || supportsRelationshipOptions ? plotControls.missingPlotType : 'matrix',
        color_scale: supportsDistributionOptions || supportsRelationshipOptions || labSection === 'heat_map'
          ? plotControls.colorScale
          : 'Blues',
        regression_order: supportsRelationshipOptions ? plotControls.regressionOrder : 1,
        confidence_level: supportsRelationshipOptions ? plotControls.confidenceLevel : 0.95,
        marker_opacity: supportsRelationshipOptions || supportsDistributionOptions || supportsTimeSeriesOptions
          ? plotControls.markerOpacity
          : 0.78,
        marker_size: supportsRelationshipOptions || supportsDistributionOptions || supportsTimeSeriesOptions
          ? plotControls.markerSize
          : 7,
        facet_variables: supportsTimeSeriesOptions ? plotControls.facetVariables : false,
        same_y_axis: supportsTimeSeriesOptions ? plotControls.sameYAxis : false,
        facet_columns: supportsTimeSeriesOptions ? plotControls.facetColumns : 2,
      } as const;
      const cacheKey = JSON.stringify(payload);
      const cached = plotCacheRef.current.get(cacheKey);
      if (cached) {
        if (requestId === plotRequestIdRef.current) {
          setPlotResponse(cached);
        }
        return;
      }

      const response = await runEdaPlot(payload);

      if (requestId !== plotRequestIdRef.current) {
        return;
      }

      plotCacheRef.current.set(cacheKey, response);
      if (plotCacheRef.current.size > 24) {
        const firstKey = plotCacheRef.current.keys().next().value;
        if (firstKey) {
          plotCacheRef.current.delete(firstKey);
        }
      }
      setPlotResponse(response);
    } catch (err) {
      if (requestId !== plotRequestIdRef.current) {
        return;
      }
      setPlotResponse(null);
      setPlotError(
        err instanceof Error && err.message === 'Failed to fetch'
          ? 'No se pudo conectar con el backend para construir el grafico Plotly. Verifica que la API este corriendo en http://localhost:8000.'
          : err instanceof Error
            ? err.message
            : 'Failed to build the Plotly figure.',
      );
    } finally {
      if (requestId === plotRequestIdRef.current) {
        setPlotLoading(false);
      }
    }
  }, [
    dateFrom,
    dateTo,
    granularity,
    labSection,
    manualDatasets,
    plotControls,
    plotVariableCodes,
    rowLimit,
    selectedManualDatasetId,
    selectedSourceIds,
    selectedStations,
    timeAggregation,
  ]);

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
        if (!dateFrom && !selectedManualDatasetId) {
          bootstrapActions.setDateFrom(from);
        }
        if (!dateTo && !selectedManualDatasetId) {
          bootstrapActions.setDateTo(to);
        }
        if (!selectedManualDatasetId && selectedSourceIds.length === 0) {
          bootstrapActions.setSelectedSourceIds(firstSource ? [firstSource.id] : []);
        }
        if (!rowLimit) {
          bootstrapActions.setRowLimit(Math.max(100, firstSource?.row_count ?? 100));
        }
        if (!dateFrom && !dateTo) {
          bootstrapActions.setRangePreset('all');
        }
        if (!plotViewport.from && !plotViewport.to) {
          bootstrapActions.setPlotViewport({ from: null, to: null });
        }
        setBootstrapReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load analytics filters.');
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapActions, selectedManualDatasetId, selectedSourceIds.length]);

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
      void runAnalysis();
    }, 130);

    return () => clearTimeout(timeout);
  }, [bootstrapReady, runAnalysis]);

  useEffect(() => {
    bootstrapActions.setPlotViewport({ from: null, to: null });
  }, [bootstrapActions, labSection, selectedManualDatasetId, selectedSourceIds, dateFrom, dateTo]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void runPlotRequest();
    }, 300);

    return () => clearTimeout(timeout);
  }, [runPlotRequest]);

  return {
    filters,
    manualDatasets,
    rows,
    loading,
    error,
    plotLoading,
    plotError,
    plotResponse,
    bootstrapReady,
    manualDatasetsLoading,
    setRows,
    setError,
    runAnalysis,
    runPlotRequest,
  };
}
