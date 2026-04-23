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
  selectedVariables: string[];
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
  normalizeDensity: boolean;
  cumulativeDensity: boolean;
  swarmOverlay: boolean;
}

interface BootstrapActions {
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setSelectedSourceIds: (value: number[]) => void;
  setSelectedVariables: (value: string[]) => void;
  setRowLimit: (value: number) => void;
  setRangePreset: (value: string) => void;
  setPlotViewport: (value: PlotViewport) => void;
  setPairVariableX: (value: string) => void;
  setPairVariableY: (value: string) => void;
}

interface UseAnalyticalWorkspaceControllerParams {
  activeWorkspaceId: string | null;
  labSection: LabSection;
  selection: SharedSelectionState;
  plotControls: PlotControlState;
  bootstrapActions: BootstrapActions;
}

export function useAnalyticalWorkspaceController({
  activeWorkspaceId,
  labSection,
  selection,
  plotControls,
  bootstrapActions,
}: UseAnalyticalWorkspaceControllerParams) {
  const {
    selectedSourceIds,
    selectedManualDatasetId,
    selectedStations,
    selectedVariables,
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

  const runAnalysis = useCallback(async () => {
    const selectedManualDataset =
      manualDatasets.find((dataset) => dataset.id === selectedManualDatasetId) ?? null;
    const isMeasurementManualDataset = selectedManualDataset?.dataset_kind === 'measurements';

    if (selectedSourceIds.length === 0 && !selectedManualDatasetId) {
      setRows([]);
      setError('Select at least one data source to visualize.');
      return;
    }

    if (selectedManualDatasetId && !isMeasurementManualDataset) {
      setRows([]);
      setError(null);
      return;
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
            variable_codes: selectedVariables.length > 0 ? selectedVariables : undefined,
            date_from: normalizedRange.from,
            date_to: normalizedRange.to,
            limit: effectiveLimit,
          })
        : await runAnalyticsQuery({
            source_file_ids: selectedSourceIds,
            station_codes: selectedStations.length > 0 ? selectedStations : undefined,
            variable_codes: selectedVariables.length > 0 ? selectedVariables : undefined,
            date_from: normalizedRange.from,
            date_to: normalizedRange.to,
            limit: effectiveLimit,
          } satisfies AnalyticsQueryRequest);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setRows(response.rows);
      if (response.rows.length === 0) {
        setError(
          'No data for the selected source selection and filters.',
        );
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
  }, [dateFrom, dateTo, filters, manualDatasets, rowLimit, selectedManualDatasetId, selectedSourceIds, selectedStations, selectedVariables]);

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
    const chartTypeForSection =
      labSection === 'rolling'
        ? plotControls.chartType
        : labSection === 'summary'
          ? plotControls.summaryChartType
          : labSection === 'correlation'
            ? plotControls.correlationChartType
            : null;

    setPlotLoading(true);
    setPlotError(null);
    try {
      const response = await runEdaPlot({
        section: labSection,
        source_file_ids: selectedSourceIds,
        manual_dataset_id: selectedManualDatasetId,
        station_codes: selectedStations,
        variable_codes: selectedVariables,
        date_from: normalizedRange.from ?? undefined,
        date_to: normalizedRange.to ?? undefined,
        limit: rowLimit,
        granularity,
        time_aggregation: timeAggregation,
        chart_type: chartTypeForSection,
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
        x_axis: plotControls.genericXAxis || undefined,
        y_axis: plotControls.genericYAxis || undefined,
        hue: plotControls.genericHue || undefined,
        facet_row: plotControls.genericFacetRow || undefined,
        facet_col: plotControls.genericFacetCol || undefined,
        category_order: plotControls.genericCategoryOrderInput
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        time_is_here: plotControls.timeIsHere,
        show_std_band: plotControls.showStdBand,
        cumulative: plotControls.cumulativeDensity,
        normalize_density: plotControls.normalizeDensity,
        swarm_overlay: plotControls.swarmOverlay,
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
    dateFrom,
    dateTo,
    granularity,
    labSection,
    plotControls,
    rowLimit,
    selectedManualDatasetId,
    selectedSourceIds,
    selectedStations,
    selectedVariables,
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
        const initialVariables =
          firstSource && firstSource.variable_codes.length > 0
            ? firstSource.variable_codes.slice(0, 2)
            : nextFilters.variables.slice(0, 2).map((item) => item.code);

        if (!dateFrom) {
          bootstrapActions.setDateFrom(from);
        }
        if (!dateTo) {
          bootstrapActions.setDateTo(to);
        }
        if (!selectedManualDatasetId && selectedSourceIds.length === 0) {
          bootstrapActions.setSelectedSourceIds(firstSource ? [firstSource.id] : []);
        }
        if (selectedVariables.length === 0) {
          bootstrapActions.setSelectedVariables(initialVariables);
          bootstrapActions.setPairVariableX(initialVariables[0] ?? nextFilters.variables[0]?.code ?? '');
          bootstrapActions.setPairVariableY(initialVariables[1] ?? initialVariables[0] ?? nextFilters.variables[1]?.code ?? '');
        }
        if (!rowLimit) {
          bootstrapActions.setRowLimit(Math.max(100, Math.min(5000, firstSource?.row_count ?? 5000)));
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
  }, [bootstrapActions, dateFrom, dateTo, plotViewport.from, plotViewport.to, rowLimit, selectedManualDatasetId, selectedSourceIds.length, selectedVariables.length]);

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
    }, 150);

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
