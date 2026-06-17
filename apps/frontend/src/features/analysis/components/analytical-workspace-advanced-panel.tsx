import { useEffect, useState } from 'react';
import { Database, Loader2, Sigma, TrendingUp } from 'lucide-react';

import { runAdvancedForecast, type AdvancedAnalyticsResponse, type AdvancedModel } from '@/api/modules/advanced-analytics';
import { PlotlyFigurePanel } from '@/components/common/plotly-figure-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import { AnalyticalWorkspaceKpiCard as KpiCard } from '@/features/analysis/components/analytical-workspace-kpi-card';

interface VariableOption {
  code: string;
  name: string;
}

interface AnalyticalWorkspaceAdvancedPanelProps {
  selectedDataSourceCount: number;
  selectedVariableLabels: string[];
  selectedVariables: string[];
  availableVariables: VariableOption[];
  effectiveRowWindow: {
    from: string;
    to: string;
  };
  isGenericManualDataset: boolean;
  manualDatasetColumnOptions: VariableOption[];
  genericXAxis: string;
  genericYAxis: string;
  defaultForecastHorizon: number;
  onToggleVariable: (value: string) => void;
  onGenericXAxisChange: (value: string) => void;
  onGenericYAxisChange: (value: string) => void;
}

function parseOrder(value: string, expectedSize: number): number[] | null {
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (parsed.length !== expectedSize || parsed.some((item) => !Number.isInteger(item) || item < 0)) {
    return null;
  }

  return parsed;
}

export function AnalyticalWorkspaceAdvancedPanel({
  selectedDataSourceCount,
  selectedVariableLabels,
  selectedVariables,
  availableVariables,
  effectiveRowWindow,
  isGenericManualDataset,
  manualDatasetColumnOptions,
  genericXAxis,
  genericYAxis,
  defaultForecastHorizon,
  onToggleVariable,
  onGenericXAxisChange,
  onGenericYAxisChange,
}: AnalyticalWorkspaceAdvancedPanelProps) {
  const {
    selectedSourceIds,
    selectedManualDatasetId,
    selectedStations,
    dateFrom,
    dateTo,
    granularity,
    setGranularity,
  } = useAnalyticalWorkspaceState();
  const [model, setModel] = useState<AdvancedModel>('arima');
  const [orderInput, setOrderInput] = useState('1,1,1');
  const [seasonalOrderInput, setSeasonalOrderInput] = useState('1,0,1,7');
  const [horizon, setHorizon] = useState(defaultForecastHorizon);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AdvancedAnalyticsResponse | null>(null);

  const stats = response?.stats ?? {};
  const warnings = response?.warnings ?? [];
  const statAic = typeof stats.aic === 'number' ? stats.aic : null;
  const statBic = typeof stats.bic === 'number' ? stats.bic : null;
  const statRmse = typeof stats.rmse === 'number' ? stats.rmse : null;
  const statMae = typeof stats.mae === 'number' ? stats.mae : null;
  const statTrainingPoints = typeof stats.training_points === 'number' ? stats.training_points : null;

  const columnOptions = manualDatasetColumnOptions;
  const modelOptions: { value: AdvancedModel; label: string; detail: string }[] = [
    { value: 'arima', label: 'ARIMA', detail: 'Non-seasonal' },
    { value: 'sarima', label: 'SARIMA', detail: 'Seasonal' },
    { value: 'prophet', label: 'Prophet', detail: 'Decomposition' },
  ];

  useEffect(() => {
    setHorizon(defaultForecastHorizon);
  }, [defaultForecastHorizon]);

  const handleRun = async () => {
    if (selectedDataSourceCount === 0) {
      setError('Load data first in Exploration mode before running Advanced Analytics.');
      setResponse(null);
      return;
    }

    const needsOrder = model === 'arima' || model === 'sarima';
    const order = needsOrder ? parseOrder(orderInput, 3) : null;
    if (needsOrder && !order) {
      setError('Order must contain exactly three non-negative integers, for example 1,1,1.');
      setResponse(null);
      return;
    }

    const seasonalOrder = model === 'sarima' ? parseOrder(seasonalOrderInput, 4) : [];
    if (model === 'sarima' && !seasonalOrder) {
      setError('Seasonal order must contain exactly four non-negative integers, for example 1,0,1,7.');
      setResponse(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await runAdvancedForecast({
        source_file_ids: selectedSourceIds,
        manual_dataset_id: selectedManualDatasetId,
        station_codes: selectedStations,
        variable_codes: selectedVariables,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        granularity,
        x_axis: isGenericManualDataset ? genericXAxis || undefined : undefined,
        y_axis: isGenericManualDataset ? genericYAxis || undefined : undefined,
        model,
        horizon,
        order: order ?? undefined,
        seasonal_order: model === 'sarima' ? seasonalOrder ?? undefined : undefined,
      });
      setResponse(result);
    } catch (err) {
      setResponse(null);
      if (err instanceof Error && err.message === 'Failed to fetch') {
        setError('The backend connection was interrupted. Try a coarser granularity or a shorter date window.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to run advanced analytics.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white border-[#dce5f1]">
        <CardHeader>
          <CardTitle className="text-lg">Advanced Analytics</CardTitle>
          <CardDescription>
            Runs backend forecasting models over the current selection and date range.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.4fr] gap-4">
          <div className="space-y-4">
            <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="Sources" value={selectedDataSourceCount.toString()} icon={Database} />
                <KpiCard label="Window" value={`${effectiveRowWindow.from || '--'} to ${effectiveRowWindow.to || '--'}`} icon={TrendingUp} small />
              </div>
              <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center justify-between">
                  <span>Variables</span>
                  <span className="font-medium text-foreground">{selectedVariableLabels.join(', ') || 'Auto'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Granularity</span>
                  <span className="font-medium text-foreground uppercase">{granularity}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-[#fbfdff] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Variables For Advanced Analytics</Label>
                <span className="text-[10px] text-muted-foreground">{selectedVariables.length} selected</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-auto">
                {availableVariables.map((variable) => {
                  const active = selectedVariables.includes(variable.code);
                  return (
                    <button
                      key={`advanced-variable-${variable.code}`}
                      type="button"
                      onClick={() => onToggleVariable(variable.code)}
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
              <div className="space-y-2">
                <Label className="text-xs">Model</Label>
                <div className="grid grid-cols-3 gap-2">
                  {modelOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setModel(option.value)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        model === option.value
                          ? 'border-[#1F5A8A] bg-[#eef6ff] text-[#1F5A8A]'
                          : 'border-[#dce5f1] bg-white text-[#334155] hover:border-[#509EE3]/60'
                      }`}
                    >
                      <span className="block text-xs font-semibold">{option.label}</span>
                      <span className="block text-[10px] text-muted-foreground">{option.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Granularity</Label>
                <Select value={granularity} onValueChange={(value) => setGranularity(value as typeof granularity)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Granularity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour">Hour</SelectItem>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="week">Week</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="quarter">Quarter</SelectItem>
                    <SelectItem value="year">Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(model === 'arima' || model === 'sarima') && (
                <div className="space-y-1.5">
                  <Label htmlFor="advanced-order" className="text-xs">Order (p,d,q)</Label>
                  <Input
                    id="advanced-order"
                    value={orderInput}
                    onChange={(event) => setOrderInput(event.target.value)}
                    className="h-9 text-xs"
                    placeholder="1,1,1"
                  />
                </div>
              )}
              {model === 'sarima' && (
                <div className="space-y-1.5">
                  <Label htmlFor="advanced-seasonal-order" className="text-xs">Seasonal order (P,D,Q,s)</Label>
                  <Input
                    id="advanced-seasonal-order"
                    value={seasonalOrderInput}
                    onChange={(event) => setSeasonalOrderInput(event.target.value)}
                    className="h-9 text-xs"
                    placeholder="1,0,1,7"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="advanced-horizon" className="text-xs">Forecast horizon</Label>
                <Input
                  id="advanced-horizon"
                  type="number"
                  min={1}
                  max={365}
                  value={horizon}
                  onChange={(event) =>
                    setHorizon(Math.max(1, Math.min(365, Number(event.target.value || defaultForecastHorizon))))
                  }
                  className="h-9 text-xs"
                />
              </div>
              {isGenericManualDataset && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Time axis</Label>
                    <Select value={genericXAxis} onValueChange={onGenericXAxisChange}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Time column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columnOptions.map((column) => (
                          <SelectItem key={`advanced-x-${column.code}`} value={column.code}>
                            {column.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Value axis</Label>
                    <Select value={genericYAxis} onValueChange={onGenericYAxisChange}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Value column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columnOptions.map((column) => (
                          <SelectItem key={`advanced-y-${column.code}`} value={column.code}>
                            {column.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <Button className="w-full bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" onClick={() => void handleRun()} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {loading ? 'Running model' : `Run ${model.toUpperCase()}`}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {error && (
              <Card className="bg-white border-l-4 border-l-red-400">
                <CardContent className="py-3">
                  <p className="text-sm text-red-700">{error}</p>
                </CardContent>
              </Card>
            )}

            {warnings.length > 0 && (
              <Card className="bg-white border-l-4 border-l-amber-400">
                <CardContent className="py-3 space-y-1">
                  {warnings.map((warning, index) => (
                    <p key={`advanced-warning-${index}`} className="text-sm text-amber-800">
                      {warning}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <KpiCard label="Training Points" value={statTrainingPoints?.toLocaleString() ?? '--'} icon={Database} />
              <KpiCard label="RMSE" value={statRmse !== null ? statRmse.toFixed(3) : '--'} icon={TrendingUp} />
              <KpiCard label="MAE" value={statMae !== null ? statMae.toFixed(3) : '--'} icon={TrendingUp} />
              <KpiCard label={statBic !== null ? 'BIC' : 'AIC'} value={(statBic ?? statAic) !== null ? (statBic ?? statAic)!.toFixed(2) : '--'} icon={Sigma} />
            </div>

            <div className="h-[740px] w-full">
              {response ? (
                <PlotlyFigurePanel
                  figure={response.figure_json}
                  title="Advanced Forecast"
                  description="Backend forecast result for the current selection."
                  height={720}
                  enableTimeNavigation
                  uirevision="advanced-analytics"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-md border bg-white px-6 text-center text-sm text-muted-foreground">
                  Run a model to generate the advanced forecast figure.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
