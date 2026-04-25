import type { EdaChartType } from '@/api/modules/eda';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type ChartType, type LabSection } from '@/features/analysis/lib/analytical-workspace-config';

interface ColumnOption {
  code: string;
  name: string;
}

interface AnalyticalWorkspaceInlinePlotControlsProps {
  labSection: LabSection;
  isGenericManualDataset: boolean;
  manualDatasetColumnOptions: ColumnOption[];
  chartType: ChartType;
  summaryChartType: EdaChartType;
  correlationChartType: EdaChartType;
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
  onToggleNormalizeDensity: () => void;
  onToggleCumulativeDensity: () => void;
  onToggleSwarmOverlay: () => void;
}

export function AnalyticalWorkspaceInlinePlotControls({
  labSection,
  isGenericManualDataset,
  manualDatasetColumnOptions,
  chartType,
  summaryChartType,
  correlationChartType,
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
  onToggleNormalizeDensity,
  onToggleCumulativeDensity,
  onToggleSwarmOverlay,
}: AnalyticalWorkspaceInlinePlotControlsProps) {
  const columnOptions = manualDatasetColumnOptions;
  const canUseGenericAxes = isGenericManualDataset && columnOptions.length > 0;
  const currentPlotType =
    labSection === 'rolling' ? chartType : labSection === 'summary' ? summaryChartType : correlationChartType;
  const showTimeIsHereControl = canUseGenericAxes && labSection === 'rolling';
  const showStdBandControl = labSection === 'rolling' && currentPlotType === 'line';
  const showNormalizeDensityControl = labSection === 'summary' && (summaryChartType === 'histogram' || summaryChartType === 'kde');
  const showCumulativeDensityControl = labSection === 'summary' && summaryChartType === 'kde';
  const showSwarmOverlayControl = labSection === 'summary' && (summaryChartType === 'box' || summaryChartType === 'violin');

  const hasPlotControls =
    labSection === 'summary'
    || labSection === 'correlation'
    || canUseGenericAxes
    || showTimeIsHereControl
    || showStdBandControl
    || showNormalizeDensityControl
    || showCumulativeDensityControl
    || showSwarmOverlayControl;

  if (!hasPlotControls) {
    return null;
  }

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
                  onSummaryChartTypeChange(value as EdaChartType);
                  return;
                }
                onCorrelationChartTypeChange(value as EdaChartType);
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
            <div className="space-y-1.5">
              <Label className="text-xs">Y Axis</Label>
              <Select value={genericYAxis} onValueChange={onGenericYAxisChange}>
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
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Facet Row</Label>
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
                <Label className="text-xs">Facet Col</Label>
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
            <div className="space-y-1.5">
              <Label htmlFor="category-order" className="text-xs text-muted-foreground">
                Custom order
              </Label>
              <Input
                id="category-order"
                value={genericCategoryOrderInput}
                onChange={(event) => onGenericCategoryOrderInputChange(event.target.value)}
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
