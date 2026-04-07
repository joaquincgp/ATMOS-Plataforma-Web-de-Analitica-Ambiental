import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CHART_OPTIONS,
  GRANULARITY_OPTIONS,
  type AggregationMode,
  type ChartType,
  type HeatmapProfileMode,
  type LabSection,
  type ProfileMode,
  type TimeGranularity,
} from '@/features/analysis/lib/analytical-workspace-config';

interface AnalyticalWorkspaceSectionControlsProps {
  labSection: LabSection;
  granularity: TimeGranularity;
  chartType: ChartType;
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
  pairVariableOptions: string[];
  isGenericManualDataset: boolean;
  onGranularityChange: (value: TimeGranularity) => void;
  onChartTypeChange: (value: ChartType) => void;
  onRollingWindowChange: (value: number) => void;
  onSeasonalityModeChange: (value: 'weekday' | 'month' | 'hour') => void;
  onDecompositionWindowChange: (value: number) => void;
  onProfileModeChange: (value: ProfileMode) => void;
  onProfileAggregationChange: (value: AggregationMode) => void;
  onProfileHeatmapModeChange: (value: HeatmapProfileMode) => void;
  onForecastHorizonChange: (value: number) => void;
  onChangepointWindowChange: (value: number) => void;
  onChangepointSensitivityChange: (value: number) => void;
  onToggleTrendDeseasonalized: () => void;
  onPairVariableXChange: (value: string) => void;
  onPairVariableYChange: (value: string) => void;
}

export function AnalyticalWorkspaceSectionControls({
  labSection,
  granularity,
  chartType,
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
  pairVariableOptions,
  isGenericManualDataset,
  onGranularityChange,
  onChartTypeChange,
  onRollingWindowChange,
  onSeasonalityModeChange,
  onDecompositionWindowChange,
  onProfileModeChange,
  onProfileAggregationChange,
  onProfileHeatmapModeChange,
  onForecastHorizonChange,
  onChangepointWindowChange,
  onChangepointSensitivityChange,
  onToggleTrendDeseasonalized,
  onPairVariableXChange,
  onPairVariableYChange,
}: AnalyticalWorkspaceSectionControlsProps) {
  const renderGranularityControl = (label = 'Time Detail') => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <ToggleGroup
        type="single"
        value={granularity}
        onValueChange={(value) => value && onGranularityChange(value as TimeGranularity)}
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

  if (labSection === 'rolling') {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr_auto] gap-3 items-end mb-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Chart Type</Label>
          <ToggleGroup
            type="single"
            value={chartType}
            onValueChange={(value) => value && onChartTypeChange(value as ChartType)}
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
            onChange={(event) => onRollingWindowChange(Math.max(2, Math.min(90, Number(event.target.value || 14))))}
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
        <Select value={seasonalityMode} onValueChange={(value) => onSeasonalityModeChange(value as 'weekday' | 'month' | 'hour')}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Calendar profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekday">Weekday</SelectItem>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="hour">Hour</SelectItem>
          </SelectContent>
        </Select>
        <Select value={profileAggregation} onValueChange={(value) => onProfileAggregationChange(value as AggregationMode)}>
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
        <Select value={profileMode} onValueChange={(value) => onProfileModeChange(value as ProfileMode)}>
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
        <Select value={profileAggregation} onValueChange={(value) => onProfileAggregationChange(value as AggregationMode)}>
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
        <Select value={profileHeatmapMode} onValueChange={(value) => onProfileHeatmapModeChange(value as HeatmapProfileMode)}>
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
            onChange={(event) => onDecompositionWindowChange(Math.max(2, Math.min(90, Number(event.target.value || 21))))}
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
            onChange={(event) => onForecastHorizonChange(Math.max(1, Math.min(365, Number(event.target.value || 30))))}
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
            onChange={(event) => onChangepointWindowChange(Math.max(2, Math.min(30, Number(event.target.value || 7))))}
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
              onChangepointSensitivityChange(Math.max(0.5, Math.min(6, Number(event.target.value || 2))))
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
            onClick={onToggleTrendDeseasonalized}
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
        <Select value={pairVariableX} onValueChange={onPairVariableXChange}>
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
        <Select value={pairVariableY} onValueChange={onPairVariableYChange}>
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
}
