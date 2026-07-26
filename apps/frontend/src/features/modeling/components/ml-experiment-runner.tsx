import {
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  History,
  Radio,
  Calendar,
  Database,
  DownloadCloud,
  Info,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import {
  listMLAlgorithms,
  type MLAlgorithm,
  type MLExperimentSource,
  type MLTargetVariable,
} from '@/api/modules/ml-experiments';
import { listStations, type StationSummary } from '@/api/modules/stations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useWorkspace } from '@/contexts/workspace-context';
import { useMLExperiments } from '@/hooks/use-ml-experiments';
import { formatEcuadorDateTime } from '@/shared/lib/datetime';

const TARGET_VARIABLE_OPTIONS: { label: string; code: MLTargetVariable }[] = [
  { label: 'PM2.5 Concentration', code: 'PM25' },
  { label: 'PM10 Concentration', code: 'PM10' },
  { label: 'NO2 Level', code: 'NO2' },
  { label: 'Ozone Level', code: 'O3' },
];

const ALGORITHM_LABELS: Record<string, string> = {
  lstm: 'LSTM',
  gru: 'GRU',
  transformer: 'Transformer',
};

const ALGORITHM_DESCRIPTIONS: Record<MLAlgorithm, string> = {
  lstm:
    'Red recurrente con compuertas de memoria que conserva o descarta información del historial. ATMOS utiliza una ventana de hasta 24 horas y las variables disponibles para estimar el siguiente valor.',
  gru:
    'Red recurrente con compuertas de actualización y reinicio. Captura dependencias temporales con una arquitectura más compacta que LSTM y estima el siguiente valor.',
  transformer:
    'Modelo basado en autoatención que pondera qué momentos y variables recientes son más relevantes. Conserva el orden temporal y usa el contexto completo para estimar el siguiente valor.',
};

const SPLIT_RATIOS = ['70/30', '80/20', '90/10'] as const;
const CUSTOM_SPLIT_VALUE = 'custom';
const SPLIT_RATIO_TO_TRAIN_SPLIT: Record<string, number> = {
  '70/30': 0.7,
  '80/20': 0.8,
  '90/10': 0.9,
};

const TARGET_VARIABLE_UNIT = 'µg/m³';

// The isolated REMMAQ sync always fetches these 4 archives, in this order
// (see run_ml_experiment_source_sync): target variable first, then the 3
// fixed meteorological covariates. Mirrored here purely for the progress
// checklist below — it doesn't drive any request, just the display.
const SYNC_COVARIATE_CODES = ['TMP', 'HUM', 'VEL'] as const;
const SYNC_VARIABLE_LABELS: Record<string, string> = {
  TMP: 'Temp.',
  HUM: 'Hum.',
  VEL: 'Viento',
};

function getSyncProgressVariables(targetVariableCode: string | undefined): string[] {
  return targetVariableCode ? [targetVariableCode, ...SYNC_COVARIATE_CODES] : [...SYNC_COVARIATE_CODES];
}

function getSourceLabel(source: MLExperimentSource): string {
  const variableCode = source.source_metadata.target_variable_code;
  const sampleNumber = source.source_metadata.sample_number;
  if (!variableCode) return source.name;
  return `REMMAQ ${variableCode}${sampleNumber ? ` #${sampleNumber}` : ''}`;
}

function getSourcePeriodLabel(source: MLExperimentSource): string {
  const dateFrom = source.source_metadata.date_from;
  const dateTo = source.source_metadata.date_to;
  if (dateFrom && dateTo) return `${dateFrom} → ${dateTo}`;
  if (dateFrom) return `Desde ${dateFrom}`;
  if (dateTo) return `Hasta ${dateTo}`;
  return 'Histórico disponible';
}

const PANEL_CLASS = 'rounded-lg border border-[#dce5f1] bg-[#fbfdff] p-3 space-y-2.5';
const SECTION_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-wide text-[#4d647c]';
const FIELD_LABEL_CLASS = 'text-xs text-muted-foreground';

type InfoHintEvent = ReactMouseEvent<HTMLSpanElement> | ReactFocusEvent<HTMLSpanElement>;

// Same hover-popover pattern used by the public dashboard's variable info
// icons (features/public/components/public-dashboard.tsx), kept local here
// instead of imported so this screen never depends on/touches that file.
function InfoHint({ label, text }: { label: string; text: string }) {
  const [tooltip, setTooltip] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null);

  const showTooltip = useCallback((event: InfoHintEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 280;
    const margin = 12;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, tooltipWidth / 2 + margin),
      window.innerWidth - tooltipWidth / 2 - margin,
    );
    const opensAbove = rect.bottom + 160 > window.innerHeight && rect.top > 160;
    setTooltip({
      left,
      top: opensAbove ? rect.top - 8 : rect.bottom + 8,
      placement: opensAbove ? 'top' : 'bottom',
    });
  }, []);

  return (
    <span
      className="inline-flex shrink-0"
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltip(null)}
      onFocus={showTooltip}
      onBlur={() => setTooltip(null)}
      tabIndex={0}
    >
      <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label={`Información de ${label}`} />
      {tooltip
        ? createPortal(
          <span
            className={`pointer-events-none fixed z-[3000] w-[280px] -translate-x-1/2 rounded-md border border-[#dce5f1] bg-white p-3 text-xs font-normal leading-relaxed text-muted-foreground shadow-xl ${tooltip.placement === 'top' ? '-translate-y-full' : ''
              }`}
            style={{ left: tooltip.left, top: tooltip.top }}
            role="tooltip"
          >
            <span className="mb-1 block text-sm font-semibold text-foreground">{label}</span>
            {text}
          </span>,
          document.body,
        )
        : null}
    </span>
  );
}

export function MLExperimentRunner() {
  const { activeWorkspaceId } = useWorkspace();
  const {
    currentRun,
    runs,
    isTraining,
    error,
    submitRun,
    loadRun,
    deleteRun,
    clearHistory,
    sources,
    sourcesLoading,
    sourceError,
    syncingSourceId,
    syncSource,
    refreshSource,
    deleteSource,
  } = useMLExperiments(activeWorkspaceId);

  const [availableAlgorithms, setAvailableAlgorithms] = useState<MLAlgorithm[]>([]);
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [selectedStationCodes, setSelectedStationCodes] = useState<string[]>([]);

  const [targetVariable, setTargetVariable] = useState<MLTargetVariable>('PM25');
  const [algorithm, setAlgorithm] = useState<MLAlgorithm | ''>('');
  const [epochs, setEpochs] = useState(50);
  const [learningRate, setLearningRate] = useState('0.01');
  const [splitRatio, setSplitRatio] = useState<(typeof SPLIT_RATIOS)[number] | typeof CUSTOM_SPLIT_VALUE>('80/20');
  const [customTrainPercent, setCustomTrainPercent] = useState('75');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);

  useEffect(() => {
    void listMLAlgorithms().then((response) => {
      setAvailableAlgorithms(response.algorithms);
      setAlgorithm((current) => (current ? current : response.algorithms[0] ?? ''));
    });
    void listStations().then((response) => {
      setStations(response.items);
    });
  }, []);

  useEffect(() => {
    if (selectedSourceId && !sources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(null);
    }
  }, [sources, selectedSourceId]);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;

  const targetVariableLabel = useMemo(
    () => TARGET_VARIABLE_OPTIONS.find((option) => option.code === targetVariable)?.label ?? targetVariable,
    [targetVariable],
  );

  const parsedLearningRate = Number(learningRate);
  const isLearningRateValid = Number.isFinite(parsedLearningRate) && parsedLearningRate > 0 && parsedLearningRate <= 1;
  const isDateRangeValid = !dateFrom || !dateTo || dateFrom <= dateTo;
  const parsedCustomTrainPercent = Number(customTrainPercent);
  const isCustomSplit = splitRatio === CUSTOM_SPLIT_VALUE;
  const isCustomSplitValid =
    Number.isFinite(parsedCustomTrainPercent) && parsedCustomTrainPercent >= 50 && parsedCustomTrainPercent <= 95;
  const selectedTrainSplit = isCustomSplit
    ? parsedCustomTrainPercent / 100
    : SPLIT_RATIO_TO_TRAIN_SPLIT[splitRatio] ?? 0.8;
  const isTrainSplitValid = !isCustomSplit || isCustomSplitValid;
  const trainPercent = Math.round(selectedTrainSplit * 100);
  const testPercent = 100 - trainPercent;

  const lossData = (currentRun?.loss_curve ?? []).map((point) => ({
    epoch: point.epoch,
    training: point.train_loss,
    validation: point.val_loss,
  }));
  const metricsData = (currentRun?.rmse_curve ?? []).map((point) => ({ epoch: point.epoch, rmse: point.rmse }));
  const featureImportance = currentRun?.feature_importance ?? [];
  const predictionData = useMemo(() => currentRun?.predictions ?? [], [currentRun]);

  // Percentile-based domain (instead of strict min/max) so a handful of
  // extreme outliers don't compress the bulk of the points into a corner.
  const predictionRange = useMemo(() => {
    if (predictionData.length === 0) {
      return { min: 0, max: 50 };
    }
    const values = predictionData.flatMap((point) => [point.actual, point.predicted]).sort((a, b) => a - b);
    const percentile = (p: number) => values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))];
    const lower = percentile(0.02);
    const upper = percentile(0.98);
    const padding = (upper - lower) * 0.1 || 1;
    return { min: Math.max(0, lower - padding), max: upper + padding };
  }, [predictionData]);
  const referenceLineData = [
    { actual: predictionRange.min, predicted: predictionRange.min },
    { actual: predictionRange.max, predicted: predictionRange.max },
  ];

  // Dynamic axis explanations: computed from the actual run's data instead of
  // a generic static blurb, so the numbers quoted always match what's plotted.
  const lossAxisInfo = useMemo(() => {
    if (lossData.length === 0) {
      return 'Eje X: época de entrenamiento. Eje Y: pérdida (MSE normalizado); valores más bajos indican mejor ajuste.';
    }
    const epochs = lossData.map((point) => point.epoch);
    const values = lossData.flatMap((point) => [point.training, point.validation]);
    return (
      `Eje X: época de entrenamiento, de ${Math.min(...epochs)} a ${Math.max(...epochs)}. ` +
      `Eje Y: pérdida (MSE normalizado, sin unidades), entre ${Math.min(...values).toFixed(2)} y ` +
      `${Math.max(...values).toFixed(2)}; valores más bajos indican mejor ajuste.`
    );
  }, [lossData]);

  const rmseAxisInfo = useMemo(() => {
    if (metricsData.length === 0) {
      return `Eje X: época de entrenamiento. Eje Y: RMSE en ${TARGET_VARIABLE_UNIT} sobre el set de validación.`;
    }
    const epochs = metricsData.map((point) => point.epoch);
    const values = metricsData.map((point) => point.rmse);
    return (
      `Eje X: época de entrenamiento, de ${Math.min(...epochs)} a ${Math.max(...epochs)}. ` +
      `Eje Y: error (RMSE) en ${TARGET_VARIABLE_UNIT} sobre el set de validación, entre ` +
      `${Math.min(...values).toFixed(2)} y ${Math.max(...values).toFixed(2)}.`
    );
  }, [metricsData]);

  const featureImportanceAxisInfo =
    'Eje X: importancia relativa de cada variable (0% a 100%, suman 100% entre todas). Eje Y: nombre de cada variable usada en el modelo.';

  const predictionAxisInfo = useMemo(
    () =>
      `Eje X: valor real medido, en ${TARGET_VARIABLE_UNIT}. Eje Y: valor predicho por el modelo, en la misma unidad. ` +
      `Ambos ejes muestran el rango ${predictionRange.min.toFixed(1)}–${predictionRange.max.toFixed(1)} ` +
      `${TARGET_VARIABLE_UNIT} (algunos valores extremos pueden quedar fuera de este rango). La línea roja punteada ` +
      'marca la predicción perfecta (real = predicho).',
    [predictionRange],
  );

  const datasetStats = currentRun?.dataset_stats ?? {};
  const trainRows = typeof datasetStats.train_rows === 'number' ? datasetStats.train_rows : null;
  const testRows = typeof datasetStats.test_rows === 'number' ? datasetStats.test_rows : null;
  const featureNames = Array.isArray(datasetStats.feature_names) ? datasetStats.feature_names : null;
  const trainingTimeSeconds =
    typeof datasetStats.training_time_seconds === 'number' ? datasetStats.training_time_seconds : null;
  const datasetWarnings = Array.isArray(datasetStats.warnings) ? (datasetStats.warnings as string[]) : [];

  const toggleStation = (code: string) => {
    setSelectedStationCodes((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );
  };

  const handleTrain = () => {
    if (!activeWorkspaceId || !isLearningRateValid || !isDateRangeValid || !isTrainSplitValid || !algorithm) {
      return;
    }
    void submitRun({
      workspace_id: activeWorkspaceId,
      algorithm,
      target_variable: targetVariable,
      station_codes: selectedStationCodes,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      manual_dataset_id: selectedSourceId ?? undefined,
      epochs,
      learning_rate: parsedLearningRate,
      train_split: selectedTrainSplit,
    });
  };

  const handleSyncSource = () => {
    if (!activeWorkspaceId || !isDateRangeValid) {
      return;
    }
    void syncSource({
      workspace_id: activeWorkspaceId,
      target_variable_code: targetVariable,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });
  };

  const handleSelectSource = (sourceId: string) => {
    setSelectedSourceId((current) => (current === sourceId ? null : sourceId));
  };

  const handleDeleteSource = (sourceId: string) => {
    void deleteSource(sourceId);
  };

  const handleRefreshSource = async (sourceId: string) => {
    setRefreshingSourceId(sourceId);
    try {
      await refreshSource(sourceId);
    } finally {
      setRefreshingSourceId((current) => (current === sourceId ? null : current));
    }
  };

  const getBarColor = (importance: number) => {
    if (importance > 0.3) return '#509EE3';
    if (importance > 0.15) return '#10b981';
    return '#f59e0b';
  };

  const status = currentRun?.status ?? null;
  const statusLabel =
    status === 'completed'
      ? 'Training Completed'
      : status === 'failed'
        ? 'Training Failed'
        : status === 'running' || status === 'pending'
          ? 'Training in Progress...'
          : 'No experiments yet';
  const statusClassName =
    status === 'failed'
      ? 'bg-red-50 text-red-600 border border-red-200'
      : status === 'completed'
        ? 'bg-green-50 text-green-700 border border-green-200'
        : isTraining
          ? 'bg-[#509EE3]/10 text-[#1F5A8A] border border-[#509EE3]/20'
          : 'bg-secondary text-muted-foreground border border-border';

  return (
    <div className="h-full min-h-0 bg-[#f7fafc] p-4 flex flex-col xl:flex-row gap-4">
      {/* Left Sidebar - Configuration */}
      <Card className="w-full xl:w-[380px] 2xl:w-[400px] bg-white border-[#dce5f1] flex flex-col overflow-hidden shrink-0 max-h-full">
        <CardHeader className="px-4 py-3 border-b border-[#dce5f1] [.border-b]:pb-3">
          <CardTitle className="text-sm font-semibold">ML Experiments</CardTitle>
          <CardDescription className="text-xs">Configura los hiperparámetros de tu experimento</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-3 px-3.5 py-3">
          {/* Data scope */}
          <div className={PANEL_CLASS}>
            <Label className={SECTION_LABEL_CLASS}>Datos</Label>

            <div className="space-y-1">
              <Label className={FIELD_LABEL_CLASS}>Target Variable</Label>
              <Select value={targetVariable} onValueChange={(value) => setTargetVariable(value as MLTargetVariable)}>
                <SelectTrigger className="w-full bg-white text-xs h-8" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_VARIABLE_OPTIONS.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className={`flex items-center gap-1.5 ${FIELD_LABEL_CLASS}`}>
                  <Radio className="w-3 h-3 text-[#509EE3]" />
                  Estaciones REMMAQ
                  <InfoHint
                    label="Estaciones REMMAQ"
                    text="Sin selección, se usa el promedio de todas las estaciones disponibles."
                  />
                </Label>
                {selectedStationCodes.length > 0 && (
                  <span className="text-xs text-[#509EE3]">{selectedStationCodes.length} sel.</span>
                )}
              </div>
              {stations.length === 0 ? (
                <p className="text-xs text-muted-foreground">Cargando estaciones...</p>
              ) : (
                <div className="space-y-0.5 max-h-28 overflow-y-auto rounded-md border border-[#dce5f1] bg-white p-1.5">
                  {stations.map((station) => (
                    <label
                      key={station.code}
                      className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-[#f0f6fc] cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedStationCodes.includes(station.code)}
                        onCheckedChange={() => toggleStation(station.code)}
                      />
                      <span className="min-w-0 flex-1 truncate" title={station.name}>
                        {station.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className={`flex items-center gap-1.5 ${FIELD_LABEL_CLASS}`}>
                <Calendar className="w-3 h-3 text-[#509EE3]" />
                Rango de fechas
                <InfoHint label="Rango de fechas" text="Vacío: se usa todo el histórico REMMAQ disponible." />
              </Label>
              <div className="grid grid-cols-2 gap-1">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={`min-w-0 bg-white text-[10px] md:text-[10px] h-6 px-1 leading-none [&::-webkit-calendar-picker-indicator]:h-2.5 [&::-webkit-calendar-picker-indicator]:w-2.5 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-datetime-edit]:text-[10px] [&::-webkit-datetime-edit-fields-wrapper]:p-0 [&::-webkit-datetime-edit-text]:px-0.5 ${!isDateRangeValid ? 'border-red-400' : ''}`}
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={`min-w-0 bg-white text-[10px] md:text-[10px] h-6 px-1 leading-none [&::-webkit-calendar-picker-indicator]:h-2.5 [&::-webkit-calendar-picker-indicator]:w-2.5 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-datetime-edit]:text-[10px] [&::-webkit-datetime-edit-fields-wrapper]:p-0 [&::-webkit-datetime-edit-text]:px-0.5 ${!isDateRangeValid ? 'border-red-400' : ''}`}
                />
              </div>
              {!isDateRangeValid && (
                <p className="text-xs text-red-500">La fecha "desde" debe ser anterior a la fecha "hasta".</p>
              )}
            </div>
          </div>

          {/* Isolated ML Experiments sources */}
          <div className={PANEL_CLASS}>
            <Label className={`flex items-center gap-1.5 ${SECTION_LABEL_CLASS}`}>
              Fuentes REMMAQ
              <InfoHint
                label="Fuentes REMMAQ"
                text="Sincroniza una muestra propia para esta variable y rango de fechas, aislada de Data Manager y Advanced Analytics."
              />
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSyncSource}
              disabled={syncingSourceId !== null || !isDateRangeValid || !activeWorkspaceId}
              className="w-full h-8 bg-white text-xs whitespace-nowrap"
              title={`Sincronizar una fuente REMMAQ propia para ${targetVariableLabel}`}
            >
              {syncingSourceId ? (
                <>
                  <Loader2 className="animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <DownloadCloud />
                  Sincronizar fuente REMMAQ
                </>
              )}
            </Button>

            {sourceError && <p className="text-xs text-red-500">{sourceError}</p>}

            {sourcesLoading && sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">Cargando fuentes...</p>
            ) : sources.length > 0 ? (
              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {sources.map((source) => {
                  const isSelected = selectedSourceId === source.id;
                  const isReady = source.status === 'draft';
                  const isSyncing = source.status === 'syncing';
                  const archivesTotal = source.source_metadata.archives_total ?? 4;
                  const archivesDone = source.source_metadata.archives_done ?? 0;
                  const rowsCollected = source.source_metadata.rows_collected ?? 0;
                  const progressPercent =
                    archivesTotal > 0 ? Math.min(100, Math.round((archivesDone / archivesTotal) * 100)) : 0;
                  const sourceLabel = getSourceLabel(source);
                  const periodLabel = getSourcePeriodLabel(source);
                  const extractionLabel = formatEcuadorDateTime(
                    source.source_metadata.extracted_at ?? (isReady ? source.updated_at : null),
                    'No disponible',
                  );
                  const fullDetail = [
                    sourceLabel,
                    source.status === 'failed'
                      ? source.error_message ?? 'La sincronización falló.'
                      : `${source.row_count.toLocaleString()} filas.`,
                    isReady ? `Extraída: ${extractionLabel}.` : null,
                    `Período: ${periodLabel}.`,
                  ]
                    .filter(Boolean)
                    .join(' — ');
                  return (
                    <div
                      key={source.id}
                      className={`w-full rounded-lg border bg-white text-[11px] transition-colors ${isSelected
                        ? 'border-[#509EE3] shadow-sm ring-1 ring-[#509EE3]/20'
                        : 'border-[#dce5f1] hover:border-[#509EE3]/35'
                        }`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 w-full">
                        <Database className="w-3.5 h-3.5 shrink-0 text-[#509EE3]" />
                        <button
                          type="button"
                          onClick={() => isReady && handleSelectSource(source.id)}
                          disabled={!isReady}
                          className="flex-1 min-w-0 text-left disabled:cursor-not-allowed"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={sourceLabel}>
                              {sourceLabel}
                            </span>
                            {!isSyncing && (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${source.status === 'failed'
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-green-50 text-green-600'
                                  }`}
                              >
                                {source.status === 'failed' ? 'Falló' : 'Lista'}
                              </span>
                            )}
                          </div>
                          {!isSyncing && (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {source.status === 'failed'
                                ? 'Sincronización fallida'
                                : `${source.row_count.toLocaleString()} filas`}
                            </div>
                          )}
                        </button>
                        <InfoHint label={sourceLabel} text={fullDetail} />
                        {isSyncing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleRefreshSource(source.id)}
                            disabled={refreshingSourceId === source.id}
                            className="h-7 w-7 text-muted-foreground hover:text-[#509EE3] shrink-0"
                            title="Actualizar"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${refreshingSourceId === source.id ? 'animate-spin' : ''}`}
                            />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteSource(source.id)}
                          className="h-7 w-7 text-muted-foreground hover:text-red-500 shrink-0"
                          title="Eliminar fuente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {!isSyncing && (
                        <div className="space-y-1 border-t border-[#edf2f7] px-2 py-1.5 text-[10px] text-muted-foreground">
                          {isReady && (
                            <div className="flex min-w-0 items-center gap-1.5" title={extractionLabel}>
                              <DownloadCloud className="h-3 w-3 shrink-0 text-[#509EE3]" />
                              <span className="truncate">Extraída: {extractionLabel}</span>
                            </div>
                          )}
                          <div className="flex min-w-0 items-center gap-1.5" title={periodLabel}>
                            <Calendar className="h-3 w-3 shrink-0 text-[#509EE3]" />
                            <span className="truncate">
                              {isReady ? 'Período cubierto' : 'Período solicitado'}: {periodLabel}
                            </span>
                          </div>
                        </div>
                      )}
                      {isSyncing && (
                        <div className="px-2 pb-2 space-y-1.5">
                          <div className="flex items-center gap-1">
                            {getSyncProgressVariables(source.source_metadata.target_variable_code).map(
                              (code, index) => {
                                const isDone = index < archivesDone;
                                const isActive = index === archivesDone;
                                return (
                                  <div key={`${code}-${index}`} className="flex-1 flex flex-col items-center gap-0.5">
                                    <div
                                      className={`h-1.5 w-full rounded-full transition-colors ${isDone
                                        ? 'bg-green-500'
                                        : isActive
                                          ? 'bg-[#509EE3] animate-pulse'
                                          : 'bg-gray-200'
                                        }`}
                                    />
                                    <span
                                      className={`text-[9px] leading-none ${isDone
                                        ? 'text-green-600'
                                        : isActive
                                          ? 'font-medium text-[#509EE3]'
                                          : 'text-muted-foreground'
                                        }`}
                                    >
                                      {SYNC_VARIABLE_LABELS[code] ?? code}
                                    </span>
                                  </div>
                                );
                              },
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {archivesDone}/{archivesTotal} archivos ({progressPercent}%)
                            </span>
                            <span className="truncate">{rowsCollected.toLocaleString()} filas</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-[#dce5f1] bg-white px-2 py-2 text-xs text-muted-foreground">
                Sin fuentes sincronizadas.
              </p>
            )}

            {selectedSource ? (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-[#509EE3]/10 text-[11px] text-[#1F5A8A]">
                <span className="min-w-0 flex-1 truncate">
                  Entrenando desde:{' '}
                  <span className="font-medium">{getSourceLabel(selectedSource)}</span>
                </span>
                <InfoHint label="Fuente seleccionada" text={selectedSource.name} />
                <button
                  type="button"
                  onClick={() => setSelectedSourceId(null)}
                  className="text-[#1F5A8A]/70 hover:text-[#1F5A8A] shrink-0"
                  title="Usar el pool compartido de mediciones"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          {/* Model */}
          <div className={PANEL_CLASS}>
            <div className="flex items-center gap-1.5">
              <Label className={SECTION_LABEL_CLASS}>Modelo</Label>
              {algorithm && (
                <InfoHint
                  label={ALGORITHM_LABELS[algorithm] ?? algorithm.toUpperCase()}
                  text={ALGORITHM_DESCRIPTIONS[algorithm]}
                />
              )}
            </div>
            <Select
              value={algorithm === '' ? undefined : algorithm}
              onValueChange={(value) => setAlgorithm(value as MLAlgorithm)}
              disabled={availableAlgorithms.length === 0}
            >
              <SelectTrigger className="w-full bg-white text-xs" size="sm">
                <SelectValue placeholder="Cargando modelos..." />
              </SelectTrigger>
              <SelectContent>
                {availableAlgorithms.map((code) => (
                  <SelectItem key={code} value={code}>
                    {ALGORITHM_LABELS[code] ?? code.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Hyperparameters */}
          <div className={PANEL_CLASS}>
            <Label className={SECTION_LABEL_CLASS}>Hiperparámetros</Label>

            <div className="space-y-2">
              <Label className={FIELD_LABEL_CLASS}>
                Epochs: <span className="font-medium text-[#509EE3]">{epochs}</span>
              </Label>
              <Slider value={[epochs]} min={1} max={100} step={1} onValueChange={([value]) => setEpochs(value)} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>100</span>
              </div>
            </div>

            <div className="space-y-1">
              <Label className={FIELD_LABEL_CLASS}>Learning Rate</Label>
              <Input
                type="text"
                value={learningRate}
                onChange={(e) => setLearningRate(e.target.value)}
                className={`bg-white h-8 text-xs md:text-xs ${!isLearningRateValid ? 'border-red-400' : ''}`}
                placeholder="0.01"
              />
              {!isLearningRateValid && (
                <p className="text-xs text-red-500">Debe ser un número mayor a 0 y menor o igual a 1.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className={FIELD_LABEL_CLASS}>Train/Test Split</Label>
                <span className="shrink-0 text-[11px] font-medium text-[#1F5A8A]">
                  {trainPercent}/{testPercent}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {SPLIT_RATIOS.map((ratio) => (
                  <Button
                    key={ratio}
                    type="button"
                    variant={splitRatio === ratio ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSplitRatio(ratio)}
                    className={splitRatio === ratio ? 'h-8 px-1 text-xs' : 'h-8 bg-white px-1 text-xs'}
                  >
                    {ratio}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={isCustomSplit ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSplitRatio(CUSTOM_SPLIT_VALUE)}
                  className={isCustomSplit ? 'h-8 px-1 text-xs' : 'h-8 bg-white px-1 text-xs'}
                >
                  Manual
                </Button>
              </div>
              {isCustomSplit && (
                <div className="rounded-md border border-[#dce5f1] bg-white p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[isCustomSplitValid ? parsedCustomTrainPercent : 75]}
                      min={50}
                      max={95}
                      step={1}
                      onValueChange={([value]) => setCustomTrainPercent(String(value))}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      <Input
                        type="number"
                        min={50}
                        max={95}
                        value={customTrainPercent}
                        onChange={(event) => setCustomTrainPercent(event.target.value)}
                        onBlur={() => {
                          if (!isCustomSplitValid) {
                            setCustomTrainPercent('75');
                            return;
                          }
                          setCustomTrainPercent(String(Math.round(parsedCustomTrainPercent)));
                        }}
                        className={`h-7 w-14 shrink-0 bg-white px-1.5 text-xs md:text-xs ${!isCustomSplitValid ? 'border-red-400' : ''}`}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {isCustomSplitValid
                      ? `${Math.round(parsedCustomTrainPercent)}% entrenamiento, ${100 - Math.round(parsedCustomTrainPercent)
                      }% prueba.`
                      : 'El valor manual debe estar entre 50% y 95%.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Train Button */}
          <Button
            type="button"
            size="lg"
            onClick={handleTrain}
            disabled={
              isTraining ||
              !activeWorkspaceId ||
              !isLearningRateValid ||
              !isDateRangeValid ||
              !isTrainSplitValid ||
              !algorithm
            }
            className="w-full h-10 text-sm"
          >
            {isTraining ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Entrenando
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Entrenar modelo
              </>
            )}
          </Button>

          {/* Quick Stats */}
          <div className={PANEL_CLASS}>
            <Label className={SECTION_LABEL_CLASS}>Dataset</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md bg-white p-2 text-center">
                <div className="text-[11px] text-muted-foreground">Filas</div>
                <div className="truncate text-xs font-semibold">
                  {trainRows !== null && testRows !== null ? (trainRows + testRows).toLocaleString() : '-'}
                </div>
              </div>
              <div className="rounded-md bg-white p-2 text-center">
                <div className="text-[11px] text-muted-foreground">Vars</div>
                <div className="truncate text-xs font-semibold">{featureNames ? featureNames.length : '-'}</div>
              </div>
              <div className="rounded-md bg-white p-2 text-center">
                <div className="text-[11px] text-muted-foreground">Tiempo</div>
                <div className="truncate text-xs font-semibold">
                  {trainingTimeSeconds !== null ? `${trainingTimeSeconds}s` : '-'}
                </div>
              </div>
            </div>
            <div className="hidden">
              <span className="text-muted-foreground">Dataset Size</span>
              <span className="font-medium">
                {trainRows !== null && testRows !== null ? `${trainRows + testRows} rows` : '—'}
              </span>
            </div>
            <div className="hidden">
              <span className="text-muted-foreground">Features</span>
              <span className="font-medium">{featureNames ? `${featureNames.length} variables` : '—'}</span>
            </div>
            <div className="hidden">
              <span className="text-muted-foreground">Training Time</span>
              <span className="font-medium">{trainingTimeSeconds !== null ? `~${trainingTimeSeconds}s` : '—'}</span>
            </div>
            {featureNames && (
              <p className="line-clamp-3 text-xs leading-snug text-muted-foreground" title={featureNames.join(', ')}>
                Variables usadas: {featureNames.join(', ')}
              </p>
            )}
            {datasetWarnings.length > 0 && (
              <ul className="text-xs text-amber-600 list-disc pl-4 space-y-0.5">
                {datasetWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent Experiments */}
          {runs.length > 0 && (
            <div className={PANEL_CLASS}>
              <div className="flex items-center justify-between gap-2">
                <Label className={`${SECTION_LABEL_CLASS} min-w-0 flex items-center gap-1.5`}>
                  <History className="w-3.5 h-3.5" />
                  <span className="truncate">Historial</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void clearHistory()}
                  className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-red-500"
                  title="Eliminar todo el historial"
                >
                  Limpiar
                </Button>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className={`flex min-w-0 items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 text-[11px] transition-colors ${currentRun?.id === run.id
                      ? 'border-[#509EE3] shadow-sm ring-1 ring-[#509EE3]/20'
                      : 'border-[#dce5f1] hover:border-[#509EE3]/35'
                      }`}
                  >
                    <button onClick={() => void loadRun(run.id)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                          {(ALGORITHM_LABELS[run.algorithm] ?? run.algorithm.toUpperCase())} · {run.target_variable}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${run.status === 'failed'
                            ? 'bg-red-50 text-red-600'
                            : run.status === 'completed'
                              ? 'bg-green-50 text-green-600'
                              : 'bg-[#509EE3]/10 text-[#1F5A8A]'
                            }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      {run.final_rmse !== null && (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          RMSE: {run.final_rmse.toFixed(2)} · Split {Math.round(run.train_split * 100)}/
                          {100 - Math.round(run.train_split * 100)}
                        </div>
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void deleteRun(run.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-red-500 shrink-0"
                      title="Eliminar experimento"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Area - Results */}
      <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto">
        {/* Status Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">Experiment Results</h1>
            <p className="text-sm text-muted-foreground">Resultados del entrenamiento en tiempo real</p>
          </div>
          <div className={`flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${statusClassName}`}>
            {isTraining ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : status === 'failed' ? (
              <AlertTriangle className="w-4 h-4" />
            ) : status === 'completed' ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : null}
            <span>{statusLabel}</span>
          </div>
        </div>

        {error && (
          <Card className="border-l-4 border-l-red-400 border-y-red-100 border-r-red-100 bg-red-50/40">
            <CardContent className="flex items-start gap-2 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </CardContent>
          </Card>
        )}

        {/* Top Row: Loss Curve and RMSE Evolution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Loss Curve */}
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                Loss Curve (Training vs Validation)
                <InfoHint label="Ejes del gráfico" text={lossAxisInfo} />
              </CardTitle>
              <CardDescription>Pérdida de entrenamiento y validación por época</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={lossData} margin={{ top: 8, right: 16, bottom: 26, left: 8 }}>
                    <defs>
                      <linearGradient id="lossTrainingGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#509EE3" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#509EE3" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="lossValidationGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: '12px' }} />
                    <XAxis
                      type="number"
                      dataKey="epoch"
                      domain={['dataMin', 'dataMax']}
                      allowDecimals={false}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      label={{ value: 'Epoch', position: 'bottom', offset: 0, fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis
                      domain={[0, 'auto']}
                      tickFormatter={(value: number) => value.toFixed(2)}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      width={44}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [value.toFixed(4), name]}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="training"
                      name="Training Loss"
                      stroke="#509EE3"
                      strokeWidth={2}
                      fill="url(#lossTrainingGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="validation"
                      name="Validation Loss"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="url(#lossValidationGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* RMSE Evolution */}
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                RMSE Evolution
                <InfoHint label="Ejes del gráfico" text={rmseAxisInfo} />
              </CardTitle>
              <CardDescription>Error de predicción por época, con intervalo de confianza final</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metricsData} margin={{ top: 8, right: 16, bottom: 26, left: 8 }}>
                    <defs>
                      <linearGradient id="rmseGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      dataKey="epoch"
                      domain={['dataMin', 'dataMax']}
                      allowDecimals={false}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      label={{ value: 'Epoch', position: 'bottom', offset: 0, fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis
                      domain={[0, 'auto']}
                      tickFormatter={(value: number) => value.toFixed(1)}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      width={40}
                    />
                    <Tooltip
                      formatter={(value: number) => value.toFixed(2)}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="rmse"
                      name="RMSE"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#rmseGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 rounded-lg border border-[#dce5f1] bg-[#fbfdff] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Final RMSE</span>
                  <span className="text-lg font-semibold text-green-600">
                    {currentRun?.final_rmse !== null && currentRun?.final_rmse !== undefined
                      ? `${currentRun.final_rmse.toFixed(2)} ${TARGET_VARIABLE_UNIT}`
                      : '—'}
                  </span>
                </div>
                {currentRun?.final_rmse_ci_low !== null && currentRun?.final_rmse_ci_low !== undefined && (
                  <div className="text-xs text-muted-foreground text-right mt-0.5">
                    IC95%: {currentRun.final_rmse_ci_low.toFixed(2)} – {currentRun.final_rmse_ci_high?.toFixed(2)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row: Feature Importance and Prediction vs Actual */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Feature Importance */}
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                Feature Importance
                <InfoHint label="Ejes del gráfico" text={featureImportanceAxisInfo} />
              </CardTitle>
              <CardDescription>Contribución relativa de cada variable a la predicción</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={featureImportance}
                    layout="vertical"
                    margin={{ top: 8, right: 40, bottom: 8, left: 8 }}
                    barCategoryGap="25%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      domain={[0, 1]}
                      tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                    />
                    <YAxis
                      type="category"
                      dataKey="feature"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      width={116}
                    />
                    <Tooltip
                      formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="importance" radius={[0, 4, 4, 0]} maxBarSize={26}>
                      {featureImportance.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getBarColor(entry.importance)} />
                      ))}
                      <LabelList
                        dataKey="importance"
                        position="right"
                        formatter={(value: number) => `${Math.round(value * 100)}%`}
                        style={{ fill: '#374151', fontSize: 12 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Prediction vs Actual */}
          <Card className="bg-white border-[#dce5f1]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                Predicción vs Actual
                <InfoHint label="Ejes del gráfico" text={predictionAxisInfo} />
              </CardTitle>
              <CardDescription>Cada punto compara el valor real contra el predicho</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 26, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      dataKey="actual"
                      name="Actual"
                      domain={[predictionRange.min, predictionRange.max]}
                      allowDataOverflow
                      tickFormatter={(value: number) => value.toFixed(1)}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      label={{
                        value: `Actual (${TARGET_VARIABLE_UNIT})`,
                        position: 'bottom',
                        offset: 0,
                        fill: '#6b7280',
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="predicted"
                      name="Predicted"
                      domain={[predictionRange.min, predictionRange.max]}
                      allowDataOverflow
                      tickFormatter={(value: number) => value.toFixed(1)}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      stroke="#e5e7eb"
                      width={52}
                      label={{
                        value: `Predicted (${TARGET_VARIABLE_UNIT})`,
                        angle: -90,
                        position: 'insideLeft',
                        fill: '#6b7280',
                        fontSize: 12,
                      }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      formatter={(value: number) => value.toFixed(2)}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Scatter name="Predictions" data={predictionData} fill="#509EE3" fillOpacity={0.65} />
                    {/* Ideal line (y=x) */}
                    <Line
                      type="linear"
                      dataKey="actual"
                      data={referenceLineData}
                      stroke="#dc2626"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 rounded-lg border border-[#dce5f1] bg-[#fbfdff] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">R² Score</span>
                  <span className="text-lg font-semibold text-[#1F5A8A]">
                    {currentRun?.r_squared !== null && currentRun?.r_squared !== undefined
                      ? currentRun.r_squared.toFixed(3)
                      : '—'}
                  </span>
                </div>
                {currentRun?.r_squared_ci_low !== null && currentRun?.r_squared_ci_low !== undefined && (
                  <div className="text-xs text-muted-foreground text-right mt-0.5">
                    IC95%: {currentRun.r_squared_ci_low.toFixed(3)} – {currentRun.r_squared_ci_high?.toFixed(3)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
