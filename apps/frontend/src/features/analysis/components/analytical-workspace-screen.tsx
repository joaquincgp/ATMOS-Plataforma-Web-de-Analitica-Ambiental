import { useEffect, useMemo, useState } from 'react';
import {
  Database,
  LineChart as LineChartIcon,
  Loader2,
  Table2,
  TrendingUp,
} from 'lucide-react';
import type { EdaChartType } from '@/api/modules/eda';
import { PlotlyChart } from '@/components/common/plotly-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnalyticalWorkspaceAdvancedPanel } from '@/features/analysis/components/analytical-workspace-advanced-panel';
import { useWorkspace } from '@/contexts/workspace-context';
import { AnalyticalWorkspaceInlinePlotControls } from '@/features/analysis/components/analytical-workspace-inline-plot-controls';
import { AnalyticalWorkspaceLoadDataPanel } from '@/features/analysis/components/analytical-workspace-load-data-panel';
import { AnalyticalWorkspaceSectionControls } from '@/features/analysis/components/analytical-workspace-section-controls';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import { AnalyticalWorkspaceKpiCard as KpiCard } from '@/features/analysis/components/analytical-workspace-kpi-card';
import { AnalyticalWorkspaceSecondaryContent } from '@/features/analysis/components/analytical-workspace-secondary-content';
import { AnalyticalWorkspaceSidebar } from '@/features/analysis/components/analytical-workspace-sidebar';
import { useAnalyticalWorkspaceController } from '@/features/analysis/hooks/use-analytical-workspace-controller';
import {
  addDays,
  buildLocalSummary,
  getLabSectionDescription,
  ANALYSIS_SECTIONS,
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

export function AnalyticalWorkspaceScreen() {
  const {
    selectedSourceIds,
    setSelectedSourceIds,
    selectedManualDatasetId,
    setSelectedManualDatasetId,
    selectedStations,
    setSelectedStations,
    selectedVariables,
    setSelectedVariables,
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
  } = useAnalyticalWorkspaceState();
  const [chartType, setChartType] = useState<ChartType>('line');
  const [labSection, setLabSection] = useState<LabSection>('load-data');
  const [workspaceMode, setWorkspaceMode] = useState<'exploration' | 'advanced'>('exploration');
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
  const { activeWorkspaceId } = useWorkspace();

  const selection = useMemo(
    () => ({
      selectedSourceIds,
      selectedManualDatasetId,
      selectedStations,
      selectedVariables,
      dateFrom,
      dateTo,
      rowLimit,
      granularity,
      plotViewport,
    }),
    [
      dateFrom,
      dateTo,
      granularity,
      plotViewport,
      rowLimit,
      selectedManualDatasetId,
      selectedSourceIds,
      selectedStations,
      selectedVariables,
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
      normalizeDensity,
      cumulativeDensity,
      swarmOverlay,
    }),
    [
      chartType,
      changepointSensitivity,
      changepointWindow,
      correlationChartType,
      cumulativeDensity,
      decompositionWindow,
      forecastHorizon,
      genericCategoryOrderInput,
      genericFacetCol,
      genericFacetRow,
      genericHue,
      genericXAxis,
      genericYAxis,
      normalizeDensity,
      pairVariableX,
      pairVariableY,
      profileAggregation,
      profileHeatmapMode,
      profileMode,
      rollingWindow,
      seasonalityMode,
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
      setSelectedVariables: (value: string[]) => setSelectedVariables(value),
      setRowLimit: (value: number) => setRowLimit(value),
      setRangePreset: (value: string) => setRangePreset(value),
      setPlotViewport: (value: { from: string | null; to: string | null }) => setPlotViewport(value),
      setPairVariableX: (value: string) => setPairVariableX(value),
      setPairVariableY: (value: string) => setPairVariableY(value),
    }),
    [
      setDateFrom,
      setDateTo,
      setPairVariableX,
      setPairVariableY,
      setPlotViewport,
      setRangePreset,
      setRowLimit,
      setSelectedSourceIds,
      setSelectedVariables,
    ],
  );

  const {
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
    runAnalysis,
  } = useAnalyticalWorkspaceController({
    activeWorkspaceId,
    labSection,
    selection,
    plotControls,
    bootstrapActions,
  });

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
    () => availableVariables.map((variable) => variable.code),
    [availableVariables],
  );

  useEffect(() => {
    setRowLimit((current) => Math.min(Math.max(100, current), sourceMaxRows));
  }, [setRowLimit, sourceMaxRows]);

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
  }, [availableVariableCodes, bootstrapReady, setSelectedVariables]);

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
    void runAnalysis();
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
  const canUseGenericAxes = isGenericManualDataset && manualDatasetColumnOptions.length > 0;
  const currentInlinePlotType =
    labSection === 'rolling' ? chartType : labSection === 'summary' ? summaryChartType : correlationChartType;
  const hasInlinePlotControls =
    labSection === 'summary'
    || labSection === 'correlation'
    || canUseGenericAxes
    || (labSection === 'rolling' && currentInlinePlotType === 'line');
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

    return (
      <PlotlyChart
        figure={plotResponse.figure_json}
        height={560}
        enableTimeNavigation={isTimeNavigableSection(labSection)}
        uirevision={`eda-${labSection}`}
        onViewportChange={(viewport) => {
          setPlotViewport((current) => (
            current.from === viewport.from && current.to === viewport.to ? current : viewport
          ));
        }}
      />
    );
  };

  return (
    <div className="h-full flex bg-[#F9FBFC]">
      {workspaceMode === 'exploration' && (
        <AnalyticalWorkspaceSidebar
          collapsed={sidebarCollapsed}
          labSection={labSection}
          selectedDataSourceCount={selectedDataSourceCount}
          availableVariables={availableVariables}
          rowCount={rows.length}
          viewportBoundToRows={viewportBoundToRows}
          onSelectSection={setLabSection}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          onToggleVariable={handleToggleVariable}
        />
      )}

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

          <Tabs value={workspaceMode} onValueChange={(value) => setWorkspaceMode(value as 'exploration' | 'advanced')}>
            <TabsList className="bg-white border border-[#dce5f1] p-1 h-auto">
              <TabsTrigger value="exploration" className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white">
                Exploration
              </TabsTrigger>
              <TabsTrigger value="advanced" className="data-[state=active]:bg-[#509EE3] data-[state=active]:text-white">
                Advanced Analytics
              </TabsTrigger>
            </TabsList>

          {error && (
            <Card className="bg-white border-l-4 border-l-[#509EE3]">
              <CardContent className="py-3">
                <p className="text-sm text-[#1F5A8A]">{error}</p>
              </CardContent>
            </Card>
          )}

            <TabsContent value="exploration" className="space-y-6">
              {labSection === 'load-data' ? (
                <AnalyticalWorkspaceLoadDataPanel
                  filteredSources={filteredSources}
                  filteredManualDatasets={filteredManualDatasets}
                  manualDatasetsLoading={manualDatasetsLoading}
                  availableStations={availableStations}
                  availableVariables={availableVariables}
                  sourceMaxRows={sourceMaxRows}
                  loading={loading}
                  viewportBoundToRows={viewportBoundToRows}
                  effectiveRowWindow={effectiveRowWindow}
                  onToggleSource={handleToggleSource}
                  onSelectManualDataset={handleSelectManualDataset}
                  onToggleStation={handleToggleStation}
                  onToggleVariable={handleToggleVariable}
                  onApplyRangePreset={applyRangePreset}
                  onRun={handleRunClick}
                />
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
                      <CardDescription>{getLabSectionDescription(labSection)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <AnalyticalWorkspaceSectionControls
                        labSection={labSection}
                        granularity={granularity}
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
                      <div className="flex flex-col xl:flex-row gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="h-[560px] w-full">{renderAnalysisChart()}</div>
                        </div>
                        {hasInlinePlotControls && (
                          <div className="w-full xl:w-[320px] shrink-0">
                            <AnalyticalWorkspaceInlinePlotControls
                              labSection={labSection}
                              isGenericManualDataset={isGenericManualDataset}
                              manualDatasetColumnOptions={manualDatasetColumnOptions}
                              chartType={chartType}
                              summaryChartType={summaryChartType}
                              correlationChartType={correlationChartType}
                              genericXAxis={genericXAxis}
                              genericYAxis={genericYAxis}
                              genericHue={genericHue}
                              genericFacetRow={genericFacetRow}
                              genericFacetCol={genericFacetCol}
                              genericCategoryOrderInput={genericCategoryOrderInput}
                              timeIsHere={timeIsHere}
                              showStdBand={showStdBand}
                              normalizeDensity={normalizeDensity}
                              cumulativeDensity={cumulativeDensity}
                              swarmOverlay={swarmOverlay}
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
                              onToggleNormalizeDensity={() => setNormalizeDensity((current) => !current)}
                              onToggleCumulativeDensity={() => setCumulativeDensity((current) => !current)}
                              onToggleSwarmOverlay={() => setSwarmOverlay((current) => !current)}
                            />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <AnalyticalWorkspaceSecondaryContent
                    labSection={labSection}
                    plotResponse={plotResponse}
                    plotStats={plotStats}
                    plotVariableSummary={plotVariableSummary}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="advanced">
              <AnalyticalWorkspaceAdvancedPanel
                selectedDataSourceCount={selectedDataSourceCount}
                selectedVariableLabels={selectedVariableLabels}
                effectiveRowWindow={effectiveRowWindow}
                isGenericManualDataset={isGenericManualDataset}
                manualDatasetColumnOptions={manualDatasetColumnOptions}
                genericXAxis={genericXAxis}
                genericYAxis={genericYAxis}
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
