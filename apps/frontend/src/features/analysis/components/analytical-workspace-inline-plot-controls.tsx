import { useEffect } from 'react';
import type { EdaChartType } from '@/api/modules/eda';
import { BarChart3, Database, LineChart as LineChartIcon, Orbit } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnalysisHelpCard } from '@/features/analysis/components/analysis-help-card';
import { type ChartType, type LabSection } from '@/features/analysis/lib/analytical-workspace-config';

interface ColumnOption {
  code: string;
  name: string;
}

interface AnalyticalWorkspaceInlinePlotControlsProps {
  labSection: LabSection;
  isGenericManualDataset: boolean;
  manualDatasetColumnOptions: ColumnOption[];
  layout?: 'panel' | 'strip';
  chartType: ChartType;
  summaryChartType: EdaChartType;
  correlationChartType: EdaChartType;
  useMultiVariables: boolean;
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
  onSummaryChartTypeChange: (value: EdaChartType) => void;
  onCorrelationChartTypeChange: (value: EdaChartType) => void;
  onGenericXAxisChange: (value: string) => void;
  onGenericYAxisChange: (value: string) => void;
  onGenericHueChange: (value: string) => void;
  onGenericFacetRowChange: (value: string) => void;
  onGenericFacetColChange: (value: string) => void;
  onGenericCategoryOrderInputChange: (value: string) => void;
  onToggleTimeIsHere: () => void;
  onToggleShowStdBand: () => void;
  onToggleShowMarkers: () => void;
  onToggleNormalizeDensity: () => void;
  onToggleCumulativeDensity: () => void;
  onToggleSwarmOverlay: () => void;
  onHistogramBinsChange: (value: number) => void;
  onHistogramStatChange: (value: 'count' | 'probability' | 'percent' | 'density') => void;
  onHistogramModeChange: (value: 'overlay' | 'group' | 'stack') => void;
  onHistogramElementChange: (value: 'bars' | 'step') => void;
  onDensityKindChange: (value: 'heatmap' | 'contour') => void;
  onMissingPlotTypeChange: (value: 'matrix' | 'bars' | 'heatmap') => void;
  onColorScaleChange: (value: string) => void;
  onRegressionOrderChange: (value: number) => void;
  onConfidenceLevelChange: (value: number) => void;
  onMarkerOpacityChange: (value: number) => void;
  onMarkerSizeChange: (value: number) => void;
  onToggleFacetVariables: () => void;
  onToggleSameYAxis: () => void;
  onFacetColumnsChange: (value: number) => void;
}

function ControlLabel({ label, help }: { label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs">{label}</Label>
      <AnalysisHelpCard title={label} description={help} />
    </div>
  );
}

export function AnalyticalWorkspaceInlinePlotControls({
  labSection,
  isGenericManualDataset,
  manualDatasetColumnOptions,
  layout = 'panel',
  chartType,
  summaryChartType,
  correlationChartType,
  useMultiVariables,
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
  onSummaryChartTypeChange,
  onCorrelationChartTypeChange,
  onGenericXAxisChange,
  onGenericYAxisChange,
  onGenericHueChange,
  onGenericFacetRowChange,
  onGenericFacetColChange,
  onGenericCategoryOrderInputChange,
  onToggleTimeIsHere,
  onToggleShowStdBand,
  onToggleShowMarkers,
  onToggleNormalizeDensity,
  onToggleCumulativeDensity,
  onToggleSwarmOverlay,
  onHistogramBinsChange,
  onHistogramStatChange,
  onHistogramModeChange,
  onHistogramElementChange,
  onDensityKindChange,
  onMissingPlotTypeChange,
  onColorScaleChange,
  onRegressionOrderChange,
  onConfidenceLevelChange,
  onMarkerOpacityChange,
  onMarkerSizeChange,
  onToggleFacetVariables,
  onToggleSameYAxis,
  onFacetColumnsChange,
}: AnalyticalWorkspaceInlinePlotControlsProps) {
  const columnOptions = manualDatasetColumnOptions;
  const canUseGenericAxes = isGenericManualDataset && columnOptions.length > 0;
  const genericMultiSeriesMode =
    canUseGenericAxes && useMultiVariables && (labSection === 'rolling' || labSection === 'data_trend');
  const currentPlotType =
    labSection === 'rolling' || labSection === 'data_trend'
      ? chartType
      : labSection === 'summary' || labSection === 'distribution'
        ? summaryChartType
        : correlationChartType;
  const isDistributionSection = labSection === 'summary' || labSection === 'distribution';
  const isScatterSection = labSection === 'correlation' || labSection === 'scatter';
  const canUseGenericMappings =
    canUseGenericAxes
    && (
      isDistributionSection
      || isScatterSection
      || labSection === 'rolling'
      || labSection === 'data_trend'
    );
  const distributionPlotTypes: { value: EdaChartType; label: string; icon: typeof BarChart3 }[] = [
    { value: 'bar', label: 'Bars', icon: BarChart3 },
    { value: 'lineplot', label: 'Lines', icon: LineChartIcon },
    { value: 'histogram', label: 'Histogram', icon: BarChart3 },
    { value: 'kde', label: 'Density', icon: LineChartIcon },
    { value: 'density2', label: '2D density', icon: Database },
    { value: 'box', label: 'Box', icon: Database },
    { value: 'violin', label: 'Violin', icon: Database },
    { value: 'catplot', label: 'Catplot', icon: Orbit },
    { value: 'missing', label: 'Missing', icon: Database },
    { value: 'ridge', label: 'Ridges', icon: LineChartIcon },
  ];
  const relationPlotTypes: { value: EdaChartType; label: string; icon: typeof BarChart3 }[] = [
    { value: 'heatmap', label: 'Heatmap', icon: Database },
    { value: 'clustermap', label: 'Cluster', icon: Database },
    { value: 'scatter', label: 'Scatter', icon: Orbit },
    { value: 'density2', label: '2D density', icon: Database },
    { value: 'regression', label: 'Regression', icon: LineChartIcon },
    { value: 'pairplot', label: 'Pairplot', icon: Database },
    { value: 'catplot', label: 'Catplot', icon: Orbit },
    { value: 'missing', label: 'Missing', icon: Database },
  ];
  const measurementSummaryPlotTypes = distributionPlotTypes.filter((option) =>
    ['bar', 'histogram', 'kde', 'box', 'violin'].includes(option.value),
  );
  const measurementDistributionPlotTypes = distributionPlotTypes.filter((option) =>
    ['histogram', 'kde', 'box', 'violin'].includes(option.value),
  );
  const measurementRelationPlotTypes = relationPlotTypes.filter((option) =>
    ['heatmap', 'scatter', 'regression'].includes(option.value),
  );
  const geometryOptions = isDistributionSection
    ? isGenericManualDataset
      ? distributionPlotTypes
      : labSection === 'summary'
        ? measurementSummaryPlotTypes
        : measurementDistributionPlotTypes
    : isGenericManualDataset
      ? relationPlotTypes
      : measurementRelationPlotTypes;
  const effectiveCurrentPlotType = geometryOptions.some((option) => option.value === currentPlotType)
    ? currentPlotType
    : geometryOptions[0]?.value ?? currentPlotType;
  const handlePlotTypeChange = (value: EdaChartType) => {
    if (labSection === 'summary' || labSection === 'distribution') {
      onSummaryChartTypeChange(value);
      return;
    }
    onCorrelationChartTypeChange(value);
  };
  useEffect(() => {
    if ((isDistributionSection || isScatterSection) && effectiveCurrentPlotType !== currentPlotType) {
      handlePlotTypeChange(effectiveCurrentPlotType);
    }
  }, [currentPlotType, effectiveCurrentPlotType, isDistributionSection, isScatterSection]);

  const isCorrelationMatrixPlot = isScatterSection && (effectiveCurrentPlotType === 'heatmap' || effectiveCurrentPlotType === 'clustermap');
  const isMissingPlot = effectiveCurrentPlotType === 'missing';
  const isPairplot = effectiveCurrentPlotType === 'pairplot';
  const isRidgePlot = effectiveCurrentPlotType === 'ridge';
  const isUnivariateDistributionPlot =
    isDistributionSection && (effectiveCurrentPlotType === 'histogram' || effectiveCurrentPlotType === 'kde' || effectiveCurrentPlotType === 'box' || effectiveCurrentPlotType === 'violin' || effectiveCurrentPlotType === 'ridge');
  const showAxisControls = canUseGenericMappings && !isMissingPlot && !isCorrelationMatrixPlot && !isPairplot;
  const showYAxisControl = showAxisControls && !genericMultiSeriesMode && effectiveCurrentPlotType !== 'bar';
  const showHueControl = showAxisControls && !isRidgePlot;
  const showFacetControls = showAxisControls && !isRidgePlot && effectiveCurrentPlotType !== 'kde';
  const showCategoryOrderControl = showFacetControls || effectiveCurrentPlotType === 'bar' || effectiveCurrentPlotType === 'catplot';
  const showTimeIsHereControl = canUseGenericAxes && (labSection === 'rolling' || labSection === 'data_trend');
  const showStdBandControl = (labSection === 'rolling' || labSection === 'data_trend') && effectiveCurrentPlotType === 'line';
  const showNormalizeDensityControl = isDistributionSection && (effectiveCurrentPlotType === 'histogram' || effectiveCurrentPlotType === 'kde');
  const showCumulativeDensityControl = isDistributionSection && effectiveCurrentPlotType === 'kde';
  const showSwarmOverlayControl = isDistributionSection && (effectiveCurrentPlotType === 'box' || effectiveCurrentPlotType === 'violin');
  const showHistogramControls = isDistributionSection && effectiveCurrentPlotType === 'histogram';
  const showDensity2Controls = effectiveCurrentPlotType === 'density2';
  const showMissingControls = effectiveCurrentPlotType === 'missing';
  const showRegressionControls = effectiveCurrentPlotType === 'regression';
  const showMarkerControls = effectiveCurrentPlotType === 'scatter' || effectiveCurrentPlotType === 'regression' || effectiveCurrentPlotType === 'catplot';
  const showFacetVariableControls = genericMultiSeriesMode && (chartType === 'line' || chartType === 'bar' || chartType === 'scatter');
  const showLineMarkerControl = (labSection === 'rolling' || labSection === 'data_trend' || effectiveCurrentPlotType === 'lineplot') && effectiveCurrentPlotType !== 'bar';
  const showColorScaleControl = showDensity2Controls || effectiveCurrentPlotType === 'heatmap' || effectiveCurrentPlotType === 'clustermap' || labSection === 'heat_map';
  const colorscaleOptions = ['Blues', 'Viridis', 'Plasma', 'Cividis', 'Turbo', 'RdYlBu', 'RdBu', 'YlOrRd', 'Greens', 'Reds', 'Magma', 'Inferno'];

  const hasPlotControls =
    isDistributionSection
    || isScatterSection
    || canUseGenericMappings
    || showTimeIsHereControl
    || showStdBandControl
    || showNormalizeDensityControl
    || showCumulativeDensityControl
    || showSwarmOverlayControl
    || showFacetVariableControls
    || showLineMarkerControl
    || showColorScaleControl;

  if (!hasPlotControls) {
    return null;
  }

  return (
    <Card className="bg-[#fbfdff] border-[#dce5f1] h-fit">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Plot Controls</CardTitle>
        <CardDescription className="text-xs">Dynamic options scoped to the active chart.</CardDescription>
      </CardHeader>
      <CardContent className={layout === 'strip' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3' : 'space-y-3'}>
        {(isDistributionSection || isScatterSection) && (
          <div className="space-y-2 md:col-span-2 xl:col-span-3">
            <ControlLabel label="Geometries" help="Cambia la familia visual del analisis. Cada geometria activa solo los controles estadisticamente pertinentes para ese tipo de grafico." />
            <div className="flex flex-wrap gap-1.5">
              {geometryOptions.map((option) => {
                const Icon = option.icon;
                const active = effectiveCurrentPlotType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handlePlotTypeChange(option.value)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-[#1F5A8A] bg-[#eef6ff] text-[#1F5A8A]'
                        : 'border-[#dce5f1] bg-white text-[#334155] hover:border-[#509EE3]/60'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isCorrelationMatrixPlot && (
          <div className="rounded-lg border border-dashed border-[#509EE3]/30 bg-[#f8fbff] px-3 py-2 text-[11px] text-[#1F5A8A] md:col-span-2 xl:col-span-3">
            Correlation heatmaps and clustered heatmaps use the selected numeric variables. Axes, hue and facets are disabled because correlation is computed pairwise.
          </div>
        )}

        {isMissingPlot && (
          <div className="rounded-lg border border-dashed border-[#509EE3]/30 bg-[#f8fbff] px-3 py-2 text-[11px] text-[#1F5A8A] md:col-span-2 xl:col-span-3">
            Missing-data views use the full selected dataset to summarize completeness; X/Y mappings are not used.
          </div>
        )}

        {isPairplot && (
          <div className="rounded-lg border border-dashed border-[#509EE3]/30 bg-[#f8fbff] px-3 py-2 text-[11px] text-[#1F5A8A] md:col-span-2 xl:col-span-3">
            Pairplots use the selected numeric variables as the matrix dimensions. Use Hue only when a categorical grouping variable is meaningful.
          </div>
        )}

        {showAxisControls && (
          <>
            <div className="space-y-1.5">
              <ControlLabel label="X Axis" help="Variable usada en el eje horizontal. En series temporales conviene usar la columna de fecha; en relaciones, una variable numerica." />
              <Select value={genericXAxis} onValueChange={onGenericXAxisChange}>
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
            {showYAxisControl && (
              <div className="space-y-1.5">
                <ControlLabel label={isUnivariateDistributionPlot ? 'Value' : 'Y Axis'} help="Variable cuantitativa que se resume o se grafica en el eje vertical." />
                <Select value={genericYAxis} onValueChange={onGenericYAxisChange}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={isUnivariateDistributionPlot ? 'Value' : 'Y axis'} />
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
            )}
            {genericMultiSeriesMode && (
              <div className="rounded-md border border-dashed border-[#509EE3]/30 bg-[#f8fbff] px-3 py-2 text-[11px] text-[#1F5A8A]">
                Each selected variable is plotted as a separate series. The X axis controls time.
              </div>
            )}
            {showHueControl && (
              <div className="space-y-1.5">
                <ControlLabel label="Hue" help="Variable usada para color. En Plotly separa trazas, barras o puntos por categoria; para algunos graficos tambien admite escala continua." />
                <Select value={genericHue || '__none__'} onValueChange={(value) => onGenericHueChange(value === '__none__' ? '' : value)}>
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
            )}
            {showFacetControls && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <ControlLabel label="Facet Row" help="Divide el grafico en filas por cada categoria de la variable seleccionada." />
                  <Select
                    value={genericFacetRow || '__none__'}
                    onValueChange={(value) => onGenericFacetRowChange(value === '__none__' ? '' : value)}
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
                  <ControlLabel label="Facet Col" help="Divide el grafico en columnas por cada categoria de la variable seleccionada." />
                  <Select
                    value={genericFacetCol || '__none__'}
                    onValueChange={(value) => onGenericFacetColChange(value === '__none__' ? '' : value)}
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
            )}
            {showCategoryOrderControl && (
              <div className="space-y-1.5">
                <ControlLabel label="Custom order" help="Orden manual de categorias separado por comas. Es util para comparar grupos en una secuencia conceptual y no alfabetica." />
                <Input
                  id="category-order"
                  value={genericCategoryOrderInput}
                  onChange={(event) => onGenericCategoryOrderInputChange(event.target.value)}
                  placeholder="cat A, cat B, cat C"
                  className="h-9 text-xs"
                />
              </div>
            )}
          </>
        )}

        {showHistogramControls && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-3 md:col-span-2 xl:col-span-3">
            <div className="space-y-1.5">
              <ControlLabel label="Bins" help="Numero de intervalos del histograma. Mas bins revelan detalle, pero pueden introducir ruido visual." />
              <Input
                type="number"
                min={5}
                max={120}
                value={histogramBins}
                onChange={(event) => onHistogramBinsChange(Math.max(5, Math.min(120, Number(event.target.value || 32))))}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <ControlLabel label="Stat" help="Define la escala del histograma: conteo absoluto, densidad, probabilidad o porcentaje." />
              <Select value={histogramStat} onValueChange={(value) => onHistogramStatChange(value as typeof histogramStat)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Stat" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">Count</SelectItem>
                  <SelectItem value="density">Density</SelectItem>
                  <SelectItem value="probability">Probability</SelectItem>
                  <SelectItem value="percent">Percent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <ControlLabel label="Multiple" help="Controla como se combinan grupos por color: superpuestos, lado a lado o apilados." />
              <Select value={histogramMode} onValueChange={(value) => onHistogramModeChange(value as typeof histogramMode)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Multiple" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overlay">Layer</SelectItem>
                  <SelectItem value="group">Dodge</SelectItem>
                  <SelectItem value="stack">Stack</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <ControlLabel label="Element" help="Dibuja el histograma como barras llenas o como contorno tipo step para comparar distribuciones." />
              <Select value={histogramElement} onValueChange={(value) => onHistogramElementChange(value as typeof histogramElement)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Element" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bars">Bars</SelectItem>
                  <SelectItem value="step">Step</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {(showDensity2Controls || showColorScaleControl) && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-3">
            {showDensity2Controls && (
              <div className="space-y-1.5">
                <ControlLabel label="Density kind" help="Heatmap agrega conteos por celdas 2D; Contour estima regiones de mayor concentracion." />
                <Select value={densityKind} onValueChange={(value) => onDensityKindChange(value as typeof densityKind)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Density" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="heatmap">Heatmap</SelectItem>
                    <SelectItem value="contour">Contour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {showColorScaleControl && (
              <div className="space-y-1.5">
                <ControlLabel label="Colorscale" help="Paleta continua usada en heatmaps, densidad 2D y matrices. Cambia la codificacion cromatica sin cambiar los datos." />
                <Select value={colorScale} onValueChange={onColorScaleChange}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Color scale" />
                  </SelectTrigger>
                  <SelectContent>
                    {colorscaleOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {showMissingControls && (
          <div className="space-y-1.5 rounded-lg border bg-white p-3">
            <ControlLabel label="Missing data view" help="Selecciona matriz de presencia, barras de completitud o correlacion de patrones faltantes." />
            <Select value={missingPlotType} onValueChange={(value) => onMissingPlotTypeChange(value as typeof missingPlotType)}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Missing view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matrix">Matrix</SelectItem>
                <SelectItem value="bars">Bars</SelectItem>
                <SelectItem value="heatmap">Correlation Heatmap</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {showRegressionControls && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-3">
            <div className="space-y-1.5">
              <ControlLabel label="Fit order" help="Orden del ajuste de regresion. Lineal estima tendencia monotona; polinomios capturan curvatura con mayor riesgo de sobreajuste." />
              <Select value={String(regressionOrder)} onValueChange={(value) => onRegressionOrderChange(Number(value))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Linear</SelectItem>
                  <SelectItem value="2">Polynomial 2</SelectItem>
                  <SelectItem value="3">Polynomial 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <ControlLabel label="CI" help="Nivel del intervalo de confianza alrededor de la regresion. Valores mayores producen bandas mas amplias." />
              <Select value={String(confidenceLevel)} onValueChange={(value) => onConfidenceLevelChange(Number(value))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Confidence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.68">68%</SelectItem>
                  <SelectItem value="0.9">90%</SelectItem>
                  <SelectItem value="0.95">95%</SelectItem>
                  <SelectItem value="0.99">99%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {showMarkerControls && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-3">
            <div className="space-y-1.5">
              <ControlLabel label="Marker size" help="Tamano base de los puntos. Aumentarlo mejora visibilidad; reducirlo ayuda en nubes densas." />
              <Input
                type="number"
                min={2}
                max={40}
                value={markerSize}
                onChange={(event) => onMarkerSizeChange(Math.max(2, Math.min(40, Number(event.target.value || 7))))}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <ControlLabel label="Opacity" help="Transparencia de puntos. Opacidades bajas ayudan a detectar densidad cuando hay solapamiento." />
              <Input
                type="number"
                min={0.05}
                max={1}
                step={0.05}
                value={markerOpacity}
                onChange={(event) => onMarkerOpacityChange(Math.max(0.05, Math.min(1, Number(event.target.value || 0.78))))}
                className="h-9 text-xs"
              />
            </div>
          </div>
        )}

        {showFacetVariableControls && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-white p-3 md:col-span-2 xl:col-span-3">
            <button
              type="button"
              onClick={onToggleFacetVariables}
              className={`rounded-md border px-2 py-2 text-xs transition-colors ${
                facetVariables ? 'border-[#1F5A8A] bg-[#eef6ff] text-[#1F5A8A]' : 'border-gray-300 bg-white text-foreground'
              }`}
            >
              Facet variables: {facetVariables ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={onToggleSameYAxis}
              className={`rounded-md border px-2 py-2 text-xs transition-colors ${
                sameYAxis ? 'border-[#0B7285] bg-[#ecfeff] text-[#0B7285]' : 'border-gray-300 bg-white text-foreground'
              }`}
            >
              Same Y scale: {sameYAxis ? 'on' : 'off'}
            </button>
            <div className="space-y-1.5">
              <ControlLabel label="Facet columns" help="Numero de columnas usadas al dividir multiples variables en paneles." />
              <Input
                type="number"
                min={1}
                max={4}
                value={facetColumns}
                onChange={(event) => onFacetColumnsChange(Math.max(1, Math.min(4, Number(event.target.value || 2))))}
                className="h-9 text-xs"
              />
            </div>
          </div>
        )}

        {(showTimeIsHereControl || showStdBandControl || showLineMarkerControl) && (
          <div className="space-y-2 rounded-lg border bg-white p-3">
            {showTimeIsHereControl && (
              <button
                type="button"
                onClick={onToggleTimeIsHere}
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
                onClick={onToggleShowStdBand}
                className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                  showStdBand ? 'bg-[#0B7285] text-white border-[#0B7285]' : 'bg-white text-foreground border-gray-300'
                }`}
              >
                {showStdBand ? 'Std band: on' : 'Std band: off'}
              </button>
            )}
            {showLineMarkerControl && (
              <button
                type="button"
                onClick={onToggleShowMarkers}
                className={`w-full text-xs rounded-md border px-2 py-2 transition-colors ${
                  showMarkers ? 'bg-[#1F5A8A] text-white border-[#1F5A8A]' : 'bg-white text-foreground border-gray-300'
                }`}
              >
                {showMarkers ? 'Markers: on' : 'Markers: off'}
              </button>
            )}
          </div>
        )}

        {(showNormalizeDensityControl || showCumulativeDensityControl || showSwarmOverlayControl) && (
          <div className="space-y-2 rounded-lg border bg-white p-3">
            {showNormalizeDensityControl && (
              <button
                type="button"
                onClick={onToggleNormalizeDensity}
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
                onClick={onToggleCumulativeDensity}
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
                onClick={onToggleSwarmOverlay}
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
}
