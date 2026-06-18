import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Box,
  Circle,
  Edit3,
  GripVertical,
  Hash,
  Grid3X3,
  LineChart,
  MoreHorizontal,
  Plus,
  Save,
  ScatterChart,
  Trash2,
  X,
} from 'lucide-react';

import { PlotlyChart } from '@/components/common/plotly-chart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { runEdaPlot, type EdaChartType, type EdaPlotRequest } from '@/api/modules/eda';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import {
  useDashboard,
  type DashboardCard,
  type DashboardCardSize,
  type DashboardChartKind,
  type DashboardFigure,
} from '@/features/dashboard/contexts/dashboard-context';

const PALETTE = ['#509EE3', '#F97316', '#22C55E', '#8B5CF6', '#EF4444', '#EAB308', '#06B6D4', '#EC4899'];

const CHART_TYPES: {
  kind: DashboardChartKind;
  chartType: EdaChartType;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  { kind: 'line', chartType: 'line', label: 'Linea', icon: <LineChart size={20} />, description: 'Tendencias temporales' },
  { kind: 'bar', chartType: 'bar', label: 'Barras', icon: <BarChart3 size={20} />, description: 'Comparacion entre grupos' },
  { kind: 'scatter', chartType: 'scatter', label: 'Dispersion', icon: <ScatterChart size={20} />, description: 'Relacion entre variables' },
  { kind: 'heatmap', chartType: 'heatmap', label: 'Mapa de calor', icon: <Grid3X3 size={20} />, description: 'Intensidad por eje' },
  { kind: 'histogram', chartType: 'histogram', label: 'Histograma', icon: <Circle size={20} />, description: 'Distribucion de valores' },
  { kind: 'box', chartType: 'box', label: 'Caja', icon: <Box size={20} />, description: 'Rangos y outliers' },
  { kind: 'violin', chartType: 'violin', label: 'Violin', icon: <Box size={20} />, description: 'Distribucion y densidad' },
  { kind: 'kpi', chartType: 'line', label: 'Indicador', icon: <Hash size={20} />, description: 'Numero destacado' },
];

const SIZE_OPTIONS: { value: DashboardCardSize; label: string; description: string; columns: string }[] = [
  { value: 'sm', label: 'Pequeno', description: '1/3 del ancho', columns: '4' },
  { value: 'md', label: 'Mediano', description: '1/2 del ancho', columns: '6' },
  { value: 'lg', label: 'Completo', description: 'Ancho total', columns: '12' },
];

const GEOMETRY_OPTIONS: Record<DashboardChartKind, { value: EdaChartType; label: string }[]> = {
  line: [
    { value: 'line', label: 'Linea temporal' },
    { value: 'bar', label: 'Barras temporales' },
  ],
  bar: [
    { value: 'bar', label: 'Barras' },
    { value: 'line', label: 'Linea comparativa' },
  ],
  scatter: [
    { value: 'scatter', label: 'Puntos' },
    { value: 'regression', label: 'Regresion' },
    { value: 'density2', label: 'Densidad 2D' },
  ],
  heatmap: [
    { value: 'heatmap', label: 'Heatmap' },
    { value: 'density2', label: 'Densidad' },
  ],
  histogram: [
    { value: 'histogram', label: 'Histograma' },
    { value: 'kde', label: 'Densidad KDE' },
    { value: 'box', label: 'Caja' },
    { value: 'violin', label: 'Violin' },
  ],
  box: [
    { value: 'box', label: 'Caja' },
    { value: 'violin', label: 'Violin' },
    { value: 'histogram', label: 'Histograma' },
  ],
  violin: [
    { value: 'violin', label: 'Violin' },
    { value: 'box', label: 'Caja' },
    { value: 'histogram', label: 'Histograma' },
  ],
  kpi: [
    { value: 'line', label: 'Resumen numerico' },
  ],
  plotly: [
    { value: 'line', label: 'Figura Plotly' },
  ],
};

function defaultGeometry(kind: DashboardChartKind): EdaChartType {
  return GEOMETRY_OPTIONS[kind]?.[0]?.value ?? 'line';
}

function cardColumnClass(size: DashboardCardSize) {
  if (size === 'sm') return 'xl:col-span-4';
  if (size === 'md') return 'xl:col-span-6';
  return 'xl:col-span-12';
}

function figureWithColor(figure: DashboardFigure, color: string): DashboardFigure {
  return {
    ...figure,
    data: (figure.data ?? []).map((trace) => {
      if (!trace || typeof trace !== 'object') return trace;
      const base = trace as Record<string, unknown>;
      return {
        ...base,
        marker: { ...((base.marker as Record<string, unknown> | undefined) ?? {}), color },
        line: { ...((base.line as Record<string, unknown> | undefined) ?? {}), color },
      };
    }),
  };
}


function ChartBuilder({ onClose, editingCard }: { onClose: () => void; editingCard?: DashboardCard | null }) {
  const { addCard, updateCard } = useDashboard();
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
    availableVariables,
  } = useAnalyticalWorkspaceState();
  const editingConfig = (editingCard?.config ?? {}) as Partial<EdaPlotRequest>;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<DashboardChartKind>(editingCard?.kind ?? 'line');
  const [size, setSize] = useState<DashboardCardSize>(editingCard?.size ?? 'md');
  const [color, setColor] = useState(editingCard?.color ?? PALETTE[0]);
  const [title, setTitle] = useState(editingCard?.title ?? '');
  const [description, setDescription] = useState(editingCard?.description ?? '');
  const initialVariables = editingConfig.variable_codes?.length ? editingConfig.variable_codes : selectedVariables.length > 0 ? selectedVariables : [];
  const [variables, setVariables] = useState<string[]>(initialVariables);
  const [xAxis, setXAxis] = useState(editingConfig.pair_variable_x ?? editingConfig.x_axis ?? initialVariables[0] ?? '');
  const [yAxis, setYAxis] = useState(editingConfig.pair_variable_y ?? editingConfig.y_axis ?? initialVariables[1] ?? initialVariables[0] ?? '');
  const [hue, setHue] = useState(editingConfig.hue ?? '');
  const [geometry, setGeometry] = useState<EdaChartType>(editingConfig.chart_type ?? defaultGeometry(editingCard?.kind ?? 'line'));
  const [localGranularity, setLocalGranularity] = useState<NonNullable<EdaPlotRequest['granularity']>>(editingConfig.granularity ?? granularity);
  const [localAggregation, setLocalAggregation] = useState<NonNullable<EdaPlotRequest['time_aggregation']>>(editingConfig.time_aggregation ?? timeAggregation);
  const [showMarkers, setShowMarkers] = useState(editingConfig.show_markers ?? kind === 'scatter');
  const [facetVariables, setFacetVariables] = useState(editingConfig.facet_variables ?? false);
  const [sameYAxis, setSameYAxis] = useState(editingConfig.same_y_axis ?? false);
  const [facetColumns, setFacetColumns] = useState(editingConfig.facet_columns ?? 2);
  const [histogramBins, setHistogramBins] = useState(editingConfig.histogram_bins ?? 32);
  const [histogramStat, setHistogramStat] = useState<NonNullable<EdaPlotRequest['histogram_stat']>>(editingConfig.histogram_stat ?? 'count');
  const [histogramMode, setHistogramMode] = useState<NonNullable<EdaPlotRequest['histogram_mode']>>(editingConfig.histogram_mode ?? 'overlay');
  const [histogramElement, setHistogramElement] = useState<NonNullable<EdaPlotRequest['histogram_element']>>(editingConfig.histogram_element ?? 'bars');
  const [normalizeDensity, setNormalizeDensity] = useState(editingConfig.normalize_density ?? false);
  const [cumulative, setCumulative] = useState(editingConfig.cumulative ?? false);
  const [densityKind, setDensityKind] = useState<NonNullable<EdaPlotRequest['density_kind']>>(editingConfig.density_kind ?? 'heatmap');
  const [markerOpacity, setMarkerOpacity] = useState(editingConfig.marker_opacity ?? 0.72);
  const [markerSize, setMarkerSize] = useState(editingConfig.marker_size ?? 7);
  const [regressionOrder, setRegressionOrder] = useState(editingConfig.regression_order ?? 1);
  const [confidenceLevel, setConfidenceLevel] = useState(editingConfig.confidence_level ?? 0.95);
  const [colorScale, setColorScale] = useState(editingConfig.color_scale ?? 'Viridis');
  const [preview, setPreview] = useState<DashboardFigure | null>(editingCard?.figure ?? null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasSource = selectedSourceIds.length > 0 || Boolean(selectedManualDatasetId);
  const sourceReady = hasSource && availableVariables.length > 0;
  const isRelationshipChart = kind === 'scatter' || kind === 'heatmap';
  const isDistributionChart = kind === 'histogram' || kind === 'box' || kind === 'violin';
  const isTimeSeriesChart = kind === 'line' || kind === 'bar' || kind === 'kpi';
  const requiredVariableCount = isRelationshipChart ? 2 : 1;
  const hasEnoughVariables = isRelationshipChart ? Boolean(xAxis && yAxis) : variables.length >= requiredVariableCount;
  const canAdvanceFromStepOne = sourceReady;
  const canAdvanceFromStepTwo = hasEnoughVariables;
  const canGenerate = sourceReady && hasEnoughVariables;

  const handleKindSelect = (nextKind: DashboardChartKind) => {
    setKind(nextKind);
    setGeometry(defaultGeometry(nextKind));
    setShowMarkers(nextKind === 'scatter' || nextKind === 'line');
    if (nextKind === 'scatter' || nextKind === 'heatmap') {
      const candidates = variables.length > 0 ? variables : availableVariables.map((variable) => variable.code);
      setXAxis((current) => current || candidates[0] || '');
      setYAxis((current) => current || candidates[1] || candidates[0] || '');
    }
  };

  useEffect(() => {
    if (!sourceReady || variables.length > 0) return;
    const defaults = availableVariables.slice(0, isRelationshipChart ? 2 : 1).map((variable) => variable.code);
    setVariables(defaults);
    setXAxis((current) => current || defaults[0] || '');
    setYAxis((current) => current || defaults[1] || defaults[0] || '');
  }, [availableVariables, isRelationshipChart, sourceReady, variables.length]);

  useEffect(() => {
    if (!sourceReady || !isRelationshipChart) return;
    const candidates = variables.length > 0 ? variables : availableVariables.map((variable) => variable.code);
    setXAxis((current) => current || candidates[0] || '');
    setYAxis((current) => current || candidates[1] || candidates[0] || '');
  }, [availableVariables, isRelationshipChart, sourceReady, variables]);

  const buildPayload = (): EdaPlotRequest => ({
    section: isDistributionChart ? 'distribution' : isRelationshipChart ? 'scatter' : 'data_trend',
    source_file_ids: selectedSourceIds,
    manual_dataset_id: selectedManualDatasetId,
    station_codes: selectedStations,
    variable_codes: isRelationshipChart ? [xAxis, yAxis].filter(Boolean) : variables,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    limit: rowLimit,
    granularity: localGranularity,
    time_aggregation: localAggregation,
    chart_type: geometry,
    pair_variable_x: isRelationshipChart ? xAxis : undefined,
    pair_variable_y: isRelationshipChart ? yAxis : undefined,
    x_axis: isRelationshipChart ? xAxis : undefined,
    y_axis: isRelationshipChart ? yAxis : undefined,
    hue: hue || undefined,
    show_markers: showMarkers,
    cumulative: isDistributionChart ? cumulative : false,
    normalize_density: isDistributionChart ? normalizeDensity : false,
    histogram_bins: isDistributionChart ? histogramBins : 32,
    histogram_stat: isDistributionChart ? histogramStat : 'count',
    histogram_mode: isDistributionChart ? histogramMode : 'overlay',
    histogram_element: isDistributionChart ? histogramElement : 'bars',
    density_kind: isRelationshipChart || isDistributionChart ? densityKind : 'heatmap',
    color_scale: isRelationshipChart || isDistributionChart || geometry === 'heatmap' || geometry === 'density2' ? colorScale : 'Blues',
    regression_order: isRelationshipChart ? regressionOrder : 1,
    confidence_level: isRelationshipChart ? confidenceLevel : 0.95,
    marker_opacity: isRelationshipChart || isDistributionChart || isTimeSeriesChart ? markerOpacity : 0.78,
    marker_size: isRelationshipChart || isDistributionChart || isTimeSeriesChart ? markerSize : 7,
    facet_variables: isTimeSeriesChart && variables.length > 1 ? facetVariables : false,
    same_y_axis: isTimeSeriesChart && facetVariables ? sameYAxis : false,
    facet_columns: isTimeSeriesChart && facetVariables ? facetColumns : 2,
  });

  const handlePreview = async () => {
    if (!sourceReady) {
      setError('Primero selecciona y carga una fuente en Analytical Workspace para obtener variables disponibles.');
      return;
    }
    if (!hasEnoughVariables) {
      setError(`Selecciona ${requiredVariableCount} variable(s) para construir este grafico.`);
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const response = await runEdaPlot(buildPayload());
      setPreview(figureWithColor(response.figure_json, color));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'No se pudo construir la vista previa.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    if (!canGenerate) {
      setError('Completa la fuente y las variables antes de guardar.');
      return;
    }
    let figure = preview;
    if (!figure && hasSource) {
      const response = await runEdaPlot(buildPayload());
      figure = figureWithColor(response.figure_json, color);
    }
    const nextTitle = title.trim() || `${CHART_TYPES.find((item) => item.kind === kind)?.label ?? 'Visualizacion'} ${variables.join(', ')}`;
    const payload = {
      title: nextTitle,
      description: description.trim(),
      kind,
      size,
      color,
      sourceLabel: selectedManualDatasetId ? 'Dataset manual' : `${selectedSourceIds.length} fuente(s) ETL`,
      figure: figure ?? undefined,
      config: buildPayload() as unknown as Record<string, unknown>,
    };
    if (editingCard) {
      updateCard(editingCard.id, payload);
    } else {
      addCard(payload);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[20px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-950">{editingCard ? 'Editar visualizacion' : 'Nueva visualizacion'}</h2>
            <p className="mt-1 text-xs text-slate-400">Paso {step} de 3</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="h-1 bg-slate-100">
          <div className="h-full rounded-full bg-[#509EE3] transition-all" style={{ width: `${(step / 3) * 100}%` }} />
        </div>

        <div className="max-h-[calc(92vh-128px)] overflow-y-auto p-6">
          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Tipo de grafico</h3>
                <p className="text-xs text-slate-400">Elige primero la forma de visualizacion y la fuente activa del workspace.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {CHART_TYPES.map((item) => (
                  <button
                    type="button"
                    key={item.kind}
                    onClick={() => handleKindSelect(item.kind)}
                    className={`rounded-xl border-2 p-4 text-left transition ${kind === item.kind ? 'border-[#509EE3] bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <div className={kind === item.kind ? 'text-[#509EE3]' : 'text-slate-500'}>{item.icon}</div>
                    <p className="mt-3 text-sm font-bold text-slate-800">{item.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.description}</p>
                  </button>
                ))}
              </div>
              <div className={`rounded-xl border px-4 py-3 text-sm ${hasSource ? 'border-green-100 bg-green-50 text-green-800' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                Fuente de datos: {hasSource ? `${selectedSourceIds.length} fuente(s) ETL ${selectedManualDatasetId ? '+ dataset manual' : ''}` : 'sin fuente seleccionada'}
                {hasSource && availableVariables.length === 0 ? (
                  <span className="mt-1 block text-xs">Carga la fuente en Analytical Workspace para descubrir variables.</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <Label>Variables para construir la visualizacion</Label>
                {!sourceReady ? (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    No hay variables disponibles. Selecciona una fuente y carga datos en Analytical Workspace.
                  </div>
                ) : (
                  <div className="grid max-h-80 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                    {availableVariables.map((variable) => {
                      const active = variables.includes(variable.code);
                      const xActive = xAxis === variable.code;
                      const yActive = yAxis === variable.code;
                      return (
                        <div key={variable.code} className="rounded-lg border border-slate-200 bg-white p-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-800">{variable.name}</p>
                              <p className="text-[11px] uppercase tracking-[0.06em] text-slate-400">{variable.code}</p>
                            </div>
                            {isRelationshipChart ? (
                              <div className="flex shrink-0 gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setXAxis(variable.code);
                                    setVariables((current) => Array.from(new Set([variable.code, ...current])).slice(0, 4));
                                  }}
                                  className={`h-7 rounded-md px-2 text-xs font-bold ${xActive ? 'bg-[#509EE3] text-white' : 'bg-slate-100 text-slate-500'}`}
                                >
                                  X
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setYAxis(variable.code);
                                    setVariables((current) => Array.from(new Set([...current, variable.code])).slice(0, 4));
                                  }}
                                  className={`h-7 rounded-md px-2 text-xs font-bold ${yActive ? 'bg-[#509EE3] text-white' : 'bg-slate-100 text-slate-500'}`}
                                >
                                  Y
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setVariables((current) =>
                                    current.includes(variable.code)
                                      ? current.filter((item) => item !== variable.code)
                                      : isDistributionChart
                                        ? [variable.code]
                                        : [...current, variable.code],
                                  );
                                }}
                                className={`h-8 rounded-md px-3 text-xs font-bold ${active ? 'bg-[#509EE3] text-white' : 'bg-slate-100 text-slate-500'}`}
                              >
                                {active ? 'Seleccionada' : 'Seleccionar'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  {isRelationshipChart ? 'Selecciona las variables para los ejes X/Y.' : isDistributionChart ? 'Este tipo usa una variable principal.' : 'Puedes seleccionar una o varias series.'}
                </p>
              </div>
              <div className="space-y-3">
                <Label>Tamano en dashboard</Label>
                <div className="grid gap-2">
                  {SIZE_OPTIONS.map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      onClick={() => setSize(item.value)}
                      className={`rounded-lg border px-3 py-2 text-left ${size === item.value ? 'border-[#509EE3] bg-blue-50' : 'border-slate-200 bg-white'}`}
                    >
                      <p className="text-sm font-bold text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-400">{item.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Titulo</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tendencia PM2.5" />
                </div>
                <div className="space-y-2">
                  <Label>Descripcion</Label>
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe que decision o lectura habilita esta visualizacion." />
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex flex-wrap gap-2">
                    {PALETTE.map((item) => (
                      <button
                        type="button"
                        key={item}
                        onClick={() => setColor(item)}
                        className="h-8 w-8 rounded-full border-2 border-white shadow"
                        style={{ backgroundColor: item, outline: color === item ? `2px solid ${item}` : 'none' }}
                        aria-label={`Color ${item}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Parametros del grafico</p>
                    <p className="mt-1 text-xs text-slate-400">Ajusta la version exacta que quieres guardar en el dashboard.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Geometria</Label>
                      <select
                        value={geometry}
                        onChange={(event) => setGeometry(event.target.value as EdaChartType)}
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                      >
                        {GEOMETRY_OPTIONS[kind].map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Color / agrupacion</Label>
                      <select
                        value={hue}
                        onChange={(event) => setHue(event.target.value)}
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                      >
                        <option value="">Sin agrupacion</option>
                        {availableVariables.map((variable) => (
                          <option key={`hue-${variable.code}`} value={variable.code}>{variable.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {isRelationshipChart ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Eje X</Label>
                          <select
                            value={xAxis}
                            onChange={(event) => setXAxis(event.target.value)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="">Selecciona X</option>
                            {availableVariables.map((variable) => (
                              <option key={`x-${variable.code}`} value={variable.code}>{variable.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Eje Y</Label>
                          <select
                            value={yAxis}
                            onChange={(event) => setYAxis(event.target.value)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="">Selecciona Y</option>
                            {availableVariables.map((variable) => (
                              <option key={`y-${variable.code}`} value={variable.code}>{variable.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Tamano del punto: {markerSize}</Label>
                          <input
                            type="range"
                            min={3}
                            max={18}
                            value={markerSize}
                            onChange={(event) => setMarkerSize(Number(event.target.value))}
                            className="w-full accent-[#509EE3]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Opacidad: {Math.round(markerOpacity * 100)}%</Label>
                          <input
                            type="range"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={markerOpacity}
                            onChange={(event) => setMarkerOpacity(Number(event.target.value))}
                            className="w-full accent-[#509EE3]"
                          />
                        </div>
                      </div>
                      {geometry === 'regression' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Orden de regresion</Label>
                            <Input type="number" min={1} max={4} value={regressionOrder} onChange={(event) => setRegressionOrder(Number(event.target.value))} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Confianza</Label>
                            <select
                              value={confidenceLevel}
                              onChange={(event) => setConfidenceLevel(Number(event.target.value))}
                              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            >
                              <option value={0.9}>90%</option>
                              <option value={0.95}>95%</option>
                              <option value={0.99}>99%</option>
                            </select>
                          </div>
                        </div>
                      ) : null}
                      {geometry === 'density2' || kind === 'heatmap' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Perspectiva de densidad</Label>
                            <select
                              value={densityKind}
                              onChange={(event) => setDensityKind(event.target.value as NonNullable<EdaPlotRequest['density_kind']>)}
                              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            >
                              <option value="heatmap">Heatmap</option>
                              <option value="contour">Contornos</option>
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Escala de color</Label>
                            <select
                              value={colorScale}
                              onChange={(event) => setColorScale(event.target.value)}
                              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                            >
                              <option value="Viridis">Viridis</option>
                              <option value="Blues">Blues</option>
                              <option value="Turbo">Turbo</option>
                              <option value="Cividis">Cividis</option>
                            </select>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {isDistributionChart ? (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500">
                        Variable principal: {variables.length > 0 ? variables.join(', ') : 'ninguna seleccionada'}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Bins: {histogramBins}</Label>
                          <input
                            type="range"
                            min={5}
                            max={100}
                            value={histogramBins}
                            onChange={(event) => setHistogramBins(Number(event.target.value))}
                            className="w-full accent-[#509EE3]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Estadistica</Label>
                          <select
                            value={histogramStat}
                            onChange={(event) => setHistogramStat(event.target.value as NonNullable<EdaPlotRequest['histogram_stat']>)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="count">Conteo</option>
                            <option value="probability">Probabilidad</option>
                            <option value="percent">Porcentaje</option>
                            <option value="density">Densidad</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Modo</Label>
                          <select
                            value={histogramMode}
                            onChange={(event) => setHistogramMode(event.target.value as NonNullable<EdaPlotRequest['histogram_mode']>)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="overlay">Superpuesto</option>
                            <option value="group">Agrupado</option>
                            <option value="stack">Apilado</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Forma</Label>
                          <select
                            value={histogramElement}
                            onChange={(event) => setHistogramElement(event.target.value as NonNullable<EdaPlotRequest['histogram_element']>)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="bars">Barras</option>
                            <option value="step">Escalonado</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          Normalizar densidad
                          <input type="checkbox" checked={normalizeDensity} onChange={(event) => setNormalizeDensity(event.target.checked)} className="h-4 w-4 accent-[#509EE3]" />
                        </label>
                        <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          Acumulado
                          <input type="checkbox" checked={cumulative} onChange={(event) => setCumulative(event.target.checked)} className="h-4 w-4 accent-[#509EE3]" />
                        </label>
                      </div>
                    </div>
                  ) : null}

                  {isTimeSeriesChart ? (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500">
                        Series: {variables.length > 0 ? variables.join(', ') : 'ninguna seleccionada'}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Granularidad</Label>
                          <select
                            value={localGranularity}
                            onChange={(event) => setLocalGranularity(event.target.value as NonNullable<EdaPlotRequest['granularity']>)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="hour">Hora</option>
                            <option value="day">Dia</option>
                            <option value="week">Semana</option>
                            <option value="month">Mes</option>
                            <option value="quarter">Trimestre</option>
                            <option value="year">Ano</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Agregacion</Label>
                          <select
                            value={localAggregation}
                            onChange={(event) => setLocalAggregation(event.target.value as NonNullable<EdaPlotRequest['time_aggregation']>)}
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          >
                            <option value="mean">Promedio</option>
                            <option value="sum">Suma</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          Mostrar marcadores
                          <input type="checkbox" checked={showMarkers} onChange={(event) => setShowMarkers(event.target.checked)} className="h-4 w-4 accent-[#509EE3]" />
                        </label>
                        <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          Separar variables
                          <input
                            type="checkbox"
                            checked={facetVariables}
                            disabled={variables.length < 2}
                            onChange={(event) => setFacetVariables(event.target.checked)}
                            className="h-4 w-4 accent-[#509EE3] disabled:opacity-40"
                          />
                        </label>
                      </div>
                      {facetVariables && variables.length > 1 ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                            Mismo eje Y
                            <input type="checkbox" checked={sameYAxis} onChange={(event) => setSameYAxis(event.target.checked)} className="h-4 w-4 accent-[#509EE3]" />
                          </label>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Columnas por faceta</Label>
                            <Input type="number" min={1} max={4} value={facetColumns} onChange={(event) => setFacetColumns(Number(event.target.value))} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <Button type="button" variant="outline" onClick={() => void handlePreview()} disabled={loadingPreview || !canGenerate} className="w-full">
                  {loadingPreview ? 'Construyendo vista previa...' : 'Actualizar vista previa'}
                </Button>
                {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
              </div>
              <div className="min-h-[320px] rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-400">Vista previa</p>
                {preview ? (
                  <PlotlyChart figure={preview} height={290} uirevision="dashboard-builder-preview" />
                ) : (
                  <div className="flex h-[290px] items-center justify-center rounded-lg bg-white text-center text-sm text-slate-400">
                    Genera una vista previa con la fuente y variables seleccionadas.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)} className="flex-1">
              Atras
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => setStep((current) => (current + 1) as 1 | 2 | 3)}
              disabled={(step === 1 && !canAdvanceFromStepOne) || (step === 2 && !canAdvanceFromStepTwo)}
              className="flex-[2] bg-[#509EE3] text-white hover:bg-[#509EE3]/90 disabled:bg-slate-200 disabled:text-slate-400"
            >
              Continuar
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canGenerate}
              className="flex-[2] bg-[#509EE3] text-white hover:bg-[#509EE3]/90 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <Save className="mr-2 h-4 w-4" />
              Guardar visualizacion
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardCardView({ card }: { card: DashboardCard }) {
  const { removeCard, resizeCard, moveCard } = useDashboard();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const height = card.size === 'sm' ? 230 : card.size === 'md' ? 300 : 360;

  return (
    <>
      {editing ? <ChartBuilder editingCard={card} onClose={() => setEditing(false)} /> : null}
      <div className={`col-span-12 ${cardColumnClass(card.size)} overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm transition hover:shadow-md`}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 gap-2">
            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-900">{card.title}</h3>
              {card.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">{card.description}</p> : null}
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-1">
            {SIZE_OPTIONS.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => resizeCard(card.id, item.value)}
                className={`h-6 w-6 rounded-md text-[10px] font-bold ${card.size === item.value ? 'bg-[#509EE3] text-white' : 'bg-slate-50 text-slate-400'}`}
                title={item.label}
              >
                {item.columns}
              </button>
            ))}
            <button type="button" onClick={() => setMenuOpen((current) => !current)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100">
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <button type="button" onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                  <Edit3 className="h-3.5 w-3.5" /> Editar
                </button>
                <button type="button" onClick={() => moveCard(card.id, 'left')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-3.5 w-3.5" /> Mover antes
                </button>
                <button type="button" onClick={() => moveCard(card.id, 'right')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                  <ArrowRight className="h-3.5 w-3.5" /> Mover despues
                </button>
                <button type="button" onClick={() => removeCard(card.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="p-3">
          {card.figure ? (
            <PlotlyChart figure={card.figure} height={height} uirevision={`dashboard-${card.id}`} />
          ) : (
            <div className="flex items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-400" style={{ height }}>
              Esta tarjeta no tiene una figura renderizable.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function ProjectAnalyticsDashboard() {
  const { cards } = useDashboard();
  const [showBuilder, setShowBuilder] = useState(false);
  const totalCards = cards.length;
  const wideCards = useMemo(() => cards.filter((card) => card.size === 'lg').length, [cards]);

  return (
    <div className="min-h-full bg-[#F8FAFC] p-5">
      {showBuilder ? <ChartBuilder onClose={() => setShowBuilder(false)} /> : null}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-950">Dashboard BI</h1>
          <p className="mt-1 text-sm text-slate-500">Construye un grid fluido con visualizaciones guardadas del proyecto activo.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            {totalCards} bloques · {wideCards} completos
          </div>
          <Button onClick={() => setShowBuilder(true)} className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90">
            <Plus className="mr-2 h-4 w-4" />
            Agregar visualizacion
          </Button>
        </div>
      </div>

      {cards.length === 0 ? (
        <button
          type="button"
          onClick={() => setShowBuilder(true)}
          className="flex min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-slate-300 bg-white/60 text-center transition hover:border-[#509EE3] hover:bg-blue-50"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#509EE3]">
            <BarChart3 className="h-8 w-8" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">Dashboard vacio</p>
            <p className="mt-1 max-w-md text-sm text-slate-400">Agrega una visualizacion nueva o envia una grafica desde el ambiente de analítica</p>
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {cards.map((card) => (
            <DashboardCardView key={card.id} card={card} />
          ))}
          <button
            type="button"
            onClick={() => setShowBuilder(true)}
            className="col-span-12 flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-slate-300 bg-transparent text-sm font-semibold text-slate-400 transition hover:border-[#509EE3] hover:bg-blue-50 xl:col-span-4"
          >
            <Plus className="h-5 w-5" />
            Agregar visualizacion
          </button>
        </div>
      )}
    </div>
  );
}
