import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  TrendingUp,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  getAnalyticsFilters,
  runAnalyticsQuery,
  type AnalyticsDataRow,
  type AnalyticsFilterOptionsResponse,
} from '@/api/modules/analytics';
import { useEtl } from '@/hooks/use-etl';
import { REMMAQ_VARIABLE_OPTIONS } from '@/api/modules/etl';

const MAX_REMMAQ_VARIABLES = 3;

interface StepperProps {
  currentStep: number;
  onStepClick: (step: number) => void;
}

function Stepper({ currentStep, onStepClick }: StepperProps) {
  const steps = [
    { number: 1, label: 'Source', description: 'Select data source' },
    { number: 2, label: 'Validation', description: 'Validate ETL results' },
    { number: 3, label: 'Mapping', description: 'Contract mapping' },
  ];

  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        {steps.map((step, index) => (
          <div key={step.number} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <button
                onClick={() => onStepClick(step.number)}
                className={`
                  w-12 h-12 rounded-full flex items-center justify-center font-semibold text-sm
                  transition-all duration-200 cursor-pointer
                  ${
                    currentStep > step.number
                      ? 'bg-[#509EE3] text-white'
                      : currentStep === step.number
                        ? 'bg-[#509EE3] text-white ring-4 ring-[#509EE3]/20'
                        : 'bg-gray-200 text-gray-500'
                  }
                `}
              >
                {currentStep > step.number ? <Check className="w-6 h-6" /> : step.number}
              </button>
              <div className="mt-2 text-center">
                <p
                  className={`text-sm font-medium ${
                    currentStep >= step.number ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-4 mt-[-40px] ${
                  currentStep > step.number ? 'bg-[#509EE3]' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface StepMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

export function DataSources() {
  const [currentStep, setCurrentStep] = useState(1);
  const [sourceType, setSourceType] = useState('file');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedVariables, setSelectedVariables] = useState<string[]>(['PM25']);
  const [remmaqDateFrom, setRemmaqDateFrom] = useState('');
  const [remmaqDateTo, setRemmaqDateTo] = useState('');
  const [remmaqForceReprocess, setRemmaqForceReprocess] = useState(false);
  const [actionMessage, setActionMessage] = useState<StepMessage | null>(null);
  const [processingAction, setProcessingAction] = useState<'sync' | 'upload' | null>(null);
  const [managerFilters, setManagerFilters] = useState<AnalyticsFilterOptionsResponse | null>(null);
  const [managerRows, setManagerRows] = useState<AnalyticsDataRow[]>([]);
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerQuerying, setManagerQuerying] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerSelectedStations, setManagerSelectedStations] = useState<string[]>([]);
  const [managerSelectedVariables, setManagerSelectedVariables] = useState<string[]>([]);
  const [managerDateFrom, setManagerDateFrom] = useState('');
  const [managerDateTo, setManagerDateTo] = useState('');
  const [managerLimit, setManagerLimit] = useState(500);

  const {
    runs,
    currentRun,
    metrics,
    previewRows,
    loading,
    refreshing,
    error,
    triggerRemmaqSync,
    uploadManualFile,
  } = useEtl();

  const latestRun = useMemo(() => currentRun ?? runs[0] ?? null, [currentRun, runs]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (nextFile) {
      const suffix = `.${nextFile.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!['.csv', '.xlsx', '.txt'].includes(suffix)) {
        setUploadedFile(null);
        setActionMessage({
          type: 'error',
          text: 'Formato no permitido. La carga manual solo soporta CSV, XLSX o TXT.',
        });
        return;
      }
    }
    setUploadedFile(nextFile);
    if (nextFile) {
      setActionMessage({ type: 'info', text: `Archivo seleccionado: ${nextFile.name}` });
    }
  };

  const handleSyncRemmaq = async () => {
    if (selectedVariables.length === 0) {
      setActionMessage({ type: 'error', text: 'Selecciona al menos una variable REMMAQ.' });
      return;
    }

    setProcessingAction('sync');
    setActionMessage(null);

    try {
      const run = await triggerRemmaqSync({
        variableCodes: selectedVariables,
        forceReprocess: remmaqForceReprocess,
        observedFrom: remmaqDateFrom || undefined,
        observedTo: remmaqDateTo || undefined,
      });
      setActionMessage({
        type: 'success',
        text: `Sync REMMAQ completado: ${run.records_inserted} insertados, ${run.records_updated} actualizados, ${run.records_skipped} omitidos.`,
      });
      setCurrentStep(2);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Falló la sincronización REMMAQ.',
      });
    } finally {
      setProcessingAction(null);
    }
  };

  const handleManualUpload = async () => {
    if (!uploadedFile) {
      setActionMessage({ type: 'error', text: 'Selecciona un archivo primero.' });
      return;
    }

    setProcessingAction('upload');
    setActionMessage(null);

    try {
      const run = await uploadManualFile(uploadedFile);
      setActionMessage({
        type: 'success',
        text: `Carga manual completada: ${run.records_inserted} insertados, ${run.records_updated} actualizados.`,
      });
      setCurrentStep(2);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Falló la carga manual.',
      });
    } finally {
      setProcessingAction(null);
    }
  };

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep((previous) => previous + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((previous) => previous - 1);
    }
  };

  const toggleVariable = (code: string) => {
    setSelectedVariables((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code);
      }
      if (current.length >= MAX_REMMAQ_VARIABLES) {
        setActionMessage({
          type: 'info',
          text: `Máximo ${MAX_REMMAQ_VARIABLES} variables por corrida.`,
        });
        return current;
      }
      return [...current, code];
    });
  };

  const toggleManagerStation = (stationCode: string) => {
    setManagerSelectedStations((current) =>
      current.includes(stationCode) ? current.filter((item) => item !== stationCode) : [...current, stationCode],
    );
  };

  const toggleManagerVariable = (variableCode: string) => {
    setManagerSelectedVariables((current) =>
      current.includes(variableCode) ? current.filter((item) => item !== variableCode) : [...current, variableCode],
    );
  };

  useEffect(() => {
    if (sourceType !== 'database' || managerLoading || managerFilters) {
      return;
    }

    const loadManagerFilters = async () => {
      setManagerLoading(true);
      setManagerError(null);
      try {
        const nextFilters = await getAnalyticsFilters();
        setManagerFilters(nextFilters);
        setManagerDateFrom(nextFilters.min_observed_at?.slice(0, 10) ?? '');
        setManagerDateTo(nextFilters.max_observed_at?.slice(0, 10) ?? '');
      } catch (err) {
        setManagerError(err instanceof Error ? err.message : 'No se pudieron cargar los filtros del Data Manager.');
      } finally {
        setManagerLoading(false);
      }
    };

    void loadManagerFilters();
  }, [managerFilters, managerLoading, sourceType]);

  const handleRunManagerQuery = async () => {
    setManagerQuerying(true);
    setManagerError(null);
    try {
      const response = await runAnalyticsQuery({
        station_codes: managerSelectedStations.length > 0 ? managerSelectedStations : undefined,
        variable_codes: managerSelectedVariables.length > 0 ? managerSelectedVariables : undefined,
        date_from: managerDateFrom || undefined,
        date_to: managerDateTo || undefined,
        limit: Math.max(100, Math.min(5000, managerLimit)),
      });
      setManagerRows(response.rows);
      if (response.rows.length === 0) {
        setManagerError('No se encontraron datos con esos filtros.');
      }
    } catch (err) {
      setManagerRows([]);
      setManagerError(err instanceof Error ? err.message : 'La consulta del Data Manager falló.');
    } finally {
      setManagerQuerying(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      <div className="px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Data Sources</h1>
          <p className="text-muted-foreground">
            ETL operativo para REMMAQ y cargas manuales con trazabilidad completa
          </p>
        </div>

        <Card className="bg-white mb-6">
          <CardContent className="pt-6">
            <Stepper currentStep={currentStep} onStepClick={setCurrentStep} />
          </CardContent>
        </Card>

        {(error !== null || actionMessage !== null) && (
          <Card className="bg-white mb-6 border-l-4 border-l-[#509EE3]">
            <CardContent className="py-4">
              {error && <p className="text-sm text-red-700">{error}</p>}
              {actionMessage && (
                <p
                  className={`text-sm ${
                    actionMessage.type === 'error'
                      ? 'text-red-700'
                      : actionMessage.type === 'success'
                        ? 'text-green-700'
                        : 'text-[#3B82F6]'
                  }`}
                >
                  {actionMessage.text}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="max-w-7xl mx-auto">
          {currentStep === 1 && (
            <SourceStep
              sourceType={sourceType}
              setSourceType={setSourceType}
              uploadedFile={uploadedFile}
              handleFileUpload={handleFileUpload}
              metrics={metrics}
              latestRun={latestRun}
              loading={loading || refreshing}
              processingAction={processingAction}
              selectedVariables={selectedVariables}
              remmaqDateFrom={remmaqDateFrom}
              remmaqDateTo={remmaqDateTo}
              remmaqForceReprocess={remmaqForceReprocess}
              onRemmaqDateFromChange={setRemmaqDateFrom}
              onRemmaqDateToChange={setRemmaqDateTo}
              onRemmaqForceReprocessChange={setRemmaqForceReprocess}
              onToggleVariable={toggleVariable}
              onSyncRemmaq={handleSyncRemmaq}
              onUploadManual={handleManualUpload}
              managerFilters={managerFilters}
              managerRows={managerRows}
              managerLoading={managerLoading}
              managerQuerying={managerQuerying}
              managerError={managerError}
              managerSelectedStations={managerSelectedStations}
              managerSelectedVariables={managerSelectedVariables}
              managerDateFrom={managerDateFrom}
              managerDateTo={managerDateTo}
              managerLimit={managerLimit}
              onManagerDateFromChange={setManagerDateFrom}
              onManagerDateToChange={setManagerDateTo}
              onManagerLimitChange={setManagerLimit}
              onManagerToggleStation={toggleManagerStation}
              onManagerToggleVariable={toggleManagerVariable}
              onRunManagerQuery={handleRunManagerQuery}
            />
          )}

          {currentStep === 2 && (
            <ValidationStep runs={runs} latestRun={latestRun} loading={loading} previewRows={previewRows} />
          )}

          {currentStep === 3 && <MappingStep previewRows={previewRows} />}
        </div>

        <div className="max-w-7xl mx-auto mt-6 flex justify-between">
          <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1}>
            Previous
          </Button>
          <Button
            onClick={handleNext}
            disabled={currentStep === 3}
            className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SourceStepProps {
  sourceType: string;
  setSourceType: (value: string) => void;
  uploadedFile: File | null;
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  metrics: { total_measurements: number; total_stations: number; total_variables: number; latest_run_status: string } | null;
  latestRun: {
    id: string;
    trigger_type: string;
    started_at: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    status: string;
    details?: Record<string, unknown>;
  } | null;
  loading: boolean;
  processingAction: 'sync' | 'upload' | null;
  selectedVariables: string[];
  remmaqDateFrom: string;
  remmaqDateTo: string;
  remmaqForceReprocess: boolean;
  onRemmaqDateFromChange: (value: string) => void;
  onRemmaqDateToChange: (value: string) => void;
  onRemmaqForceReprocessChange: (value: boolean) => void;
  onToggleVariable: (code: string) => void;
  onSyncRemmaq: () => Promise<void>;
  onUploadManual: () => Promise<void>;
  managerFilters: AnalyticsFilterOptionsResponse | null;
  managerRows: AnalyticsDataRow[];
  managerLoading: boolean;
  managerQuerying: boolean;
  managerError: string | null;
  managerSelectedStations: string[];
  managerSelectedVariables: string[];
  managerDateFrom: string;
  managerDateTo: string;
  managerLimit: number;
  onManagerDateFromChange: (value: string) => void;
  onManagerDateToChange: (value: string) => void;
  onManagerLimitChange: (value: number) => void;
  onManagerToggleStation: (stationCode: string) => void;
  onManagerToggleVariable: (variableCode: string) => void;
  onRunManagerQuery: () => Promise<void>;
}

function SourceStep({
  sourceType,
  setSourceType,
  uploadedFile,
  handleFileUpload,
  metrics,
  latestRun,
  loading,
  processingAction,
  selectedVariables,
  remmaqDateFrom,
  remmaqDateTo,
  remmaqForceReprocess,
  onRemmaqDateFromChange,
  onRemmaqDateToChange,
  onRemmaqForceReprocessChange,
  onToggleVariable,
  onSyncRemmaq,
  onUploadManual,
  managerFilters,
  managerRows,
  managerLoading,
  managerQuerying,
  managerError,
  managerSelectedStations,
  managerSelectedVariables,
  managerDateFrom,
  managerDateTo,
  managerLimit,
  onManagerDateFromChange,
  onManagerDateToChange,
  onManagerLimitChange,
  onManagerToggleStation,
  onManagerToggleVariable,
  onRunManagerQuery,
}: SourceStepProps) {
  const details = latestRun?.details ?? {};
  const stageLabel =
    typeof details.stage_label === 'string' ? details.stage_label : latestRun?.status === 'running' ? 'Procesando' : 'Completado';
  const currentVariable = typeof details.current_variable === 'string' ? details.current_variable : null;
  const currentArchive = typeof details.current_archive === 'number' ? details.current_archive : null;
  const totalArchives = typeof details.archives_total === 'number' ? details.archives_total : null;

  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Select Data Source</CardTitle>
          <CardDescription>Selecciona carga de archivos automática o manual</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => setSourceType('file')}
              className={`p-6 border-2 rounded-lg text-left transition-all ${
                sourceType === 'file'
                  ? 'border-[#509EE3] bg-[#509EE3]/5'
                  : 'border-border hover:border-[#509EE3]/50'
              }`}
            >
              <Upload className="w-8 h-8 mb-3 text-[#509EE3]" />
              <h3 className="font-semibold mb-1">File Upload</h3>
              <p className="text-xs text-muted-foreground">XLSX, CSV o TXT</p>
            </button>

            <button
              onClick={() => setSourceType('remmaq')}
              className={`p-6 border-2 rounded-lg text-left transition-all ${
                sourceType === 'remmaq'
                  ? 'border-[#509EE3] bg-[#509EE3]/5'
                  : 'border-border hover:border-[#509EE3]/50'
              }`}
            >
              <Server className="w-8 h-8 mb-3 text-[#509EE3]" />
              <h3 className="font-semibold mb-1">REMMAQ Auto-Sync</h3>
              <p className="text-xs text-muted-foreground">Página oficial de la REMMAQ</p>
            </button>

            <button
              onClick={() => setSourceType('database')}
              className={`p-6 border-2 rounded-lg text-left transition-all ${
                sourceType === 'database'
                  ? 'border-[#509EE3] bg-[#509EE3]/5'
                  : 'border-border hover:border-[#509EE3]/50'
              }`}
            >
              <Database className="w-8 h-8 mb-3 text-[#509EE3]" />
              <h3 className="font-semibold mb-1">Data Manager</h3>
              <p className="text-xs text-muted-foreground">Consulta lectora por variable, estación y fecha</p>
            </button>
          </div>

          <Separator />

          {sourceType === 'file' && (
            <div className="space-y-4">
              <Label htmlFor="file-upload" className="text-sm font-medium block">
                Upload File
              </Label>
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-[#509EE3]/50 transition-colors">
                <input
                  id="file-upload"
                  type="file"
                  accept=".csv,.xlsx,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {uploadedFile ? uploadedFile.name : 'Selecciona archivo para ETL manual'}
                  </p>
                  <p className="text-xs text-muted-foreground">CSV / XLSX / TXT</p>
                </label>
              </div>
              <div className="flex justify-end">
                <Button
                  className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                  onClick={() => void onUploadManual()}
                  disabled={!uploadedFile || processingAction === 'upload'}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {processingAction === 'upload' ? 'Uploading...' : 'Process Manual Upload'}
                </Button>
              </div>

              {latestRun?.status === 'running' && latestRun.trigger_type === 'manual' && (
                <div className="p-3 bg-white rounded-lg border border-border">
                  <div className="flex items-start gap-3">
                    <Loader2 className="w-4 h-4 mt-0.5 text-[#509EE3] animate-spin" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Procesando carga manual</p>
                      <p className="text-xs text-muted-foreground">
                        Etapa: <span className="font-medium text-foreground">{stageLabel}</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {sourceType === 'remmaq' && (
            <div className="space-y-6 border-2 border-[#509EE3]/20 rounded-lg p-6 bg-[#509EE3]/5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium block">Variables REMMAQ</Label>
                  <Badge variant="outline">
                    {selectedVariables.length}/{MAX_REMMAQ_VARIABLES}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2 rounded-lg border bg-white p-3">
                  {REMMAQ_VARIABLE_OPTIONS.map((option) => {
                    const isSelected = selectedVariables.includes(option.code);
                    const reachedLimit = selectedVariables.length >= MAX_REMMAQ_VARIABLES;
                    const isDisabled = !isSelected && reachedLimit;
                    return (
                      <button
                        key={option.code}
                        type="button"
                        onClick={() => onToggleVariable(option.code)}
                        disabled={isDisabled}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-[#509EE3] bg-[#509EE3] text-white'
                            : isDisabled
                              ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                              : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60 hover:bg-[#509EE3]/10'
                        }`}
                      >
                        {option.code}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedVariables.map((code) => {
                    const option = REMMAQ_VARIABLE_OPTIONS.find((item) => item.code === code);
                    return (
                      <Badge key={code} className="bg-[#509EE3]/15 text-[#1F5A8A] border-[#509EE3]/20 hover:bg-[#509EE3]/15">
                        {option?.label ?? code}
                      </Badge>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Máximo {MAX_REMMAQ_VARIABLES} variables por corrida. Al llegar al límite, no puedes seleccionar más.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="remmaq-date-from" className="text-xs text-muted-foreground">
                    Fecha desde
                  </Label>
                  <Input
                    id="remmaq-date-from"
                    type="date"
                    value={remmaqDateFrom}
                    onChange={(event) => onRemmaqDateFromChange(event.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="remmaq-date-to" className="text-xs text-muted-foreground">
                    Fecha hasta
                  </Label>
                  <Input
                    id="remmaq-date-to"
                    type="date"
                    value={remmaqDateTo}
                    onChange={(event) => onRemmaqDateToChange(event.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Reprocesamiento</Label>
                  <button
                    type="button"
                    onClick={() => onRemmaqForceReprocessChange(!remmaqForceReprocess)}
                    className={`h-9 w-full rounded-md border px-3 text-xs font-medium transition-colors ${
                      remmaqForceReprocess
                        ? 'border-[#509EE3] bg-[#509EE3] text-white'
                        : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                    }`}
                  >
                    {remmaqForceReprocess ? 'Force reprocess: on' : 'Force reprocess: off'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#509EE3]/20 flex items-center justify-center">
                    <Database className="w-5 h-5 text-[#509EE3]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">REMMAQ Auto-Sync Status</h3>
                    <p className="text-xs text-muted-foreground">https://datosambiente.quito.gob.ec/</p>
                  </div>
                </div>
                <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 gap-1.5">
                  <CheckCircle2 className="w-3 h-3" />
                  Online
                </Badge>
              </div>

              <div className="flex items-center justify-between p-3 bg-white rounded-lg">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Last Run:</span>
                    <span className="font-medium">
                      {latestRun ? new Date(latestRun.started_at).toLocaleString() : 'No runs yet'}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                  onClick={() => void onSyncRemmaq()}
                  disabled={processingAction === 'sync'}
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  {processingAction === 'sync' ? 'Syncing...' : 'Sync Now'}
                </Button>
              </div>

              <div className="p-3 bg-white rounded-lg border border-border">
                {latestRun?.status === 'running' ? (
                  <div className="flex items-start gap-3">
                    <Loader2 className="w-4 h-4 mt-0.5 text-[#509EE3] animate-spin" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">REMMAQ sync en progreso</p>
                      <p className="text-xs text-muted-foreground">
                        Etapa: <span className="font-medium text-foreground">{stageLabel}</span>
                        {currentVariable ? ` · Variable: ${currentVariable}` : ''}
                        {currentArchive && totalArchives ? ` · Archivo ${currentArchive}/${totalArchives}` : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Estado ETL</p>
                    <p className="text-xs text-muted-foreground">
                      Última etapa conocida: <span className="font-medium text-foreground">{stageLabel}</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <MetricCard
                  label="Measurements"
                  value={metrics ? metrics.total_measurements.toLocaleString() : '--'}
                  hint="Total"
                />
                <MetricCard
                  label="Stations"
                  value={metrics ? String(metrics.total_stations) : '--'}
                  hint="Catalog"
                />
                <MetricCard
                  label="Variables"
                  value={metrics ? String(metrics.total_variables) : '--'}
                  hint="Detected"
                />
                <MetricCard
                  label="Last Status"
                  value={metrics ? metrics.latest_run_status : '--'}
                  hint="Run"
                />
              </div>

              {loading && <p className="text-xs text-muted-foreground">Cargando estado ETL...</p>}
            </div>
          )}

          {sourceType === 'database' && (
            <DataManagerPanel
              filters={managerFilters}
              rows={managerRows}
              loading={managerLoading}
              querying={managerQuerying}
              error={managerError}
              selectedStations={managerSelectedStations}
              selectedVariables={managerSelectedVariables}
              dateFrom={managerDateFrom}
              dateTo={managerDateTo}
              limit={managerLimit}
              onDateFromChange={onManagerDateFromChange}
              onDateToChange={onManagerDateToChange}
              onLimitChange={onManagerLimitChange}
              onToggleStation={onManagerToggleStation}
              onToggleVariable={onManagerToggleVariable}
              onRunQuery={onRunManagerQuery}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface DataManagerPanelProps {
  filters: AnalyticsFilterOptionsResponse | null;
  rows: AnalyticsDataRow[];
  loading: boolean;
  querying: boolean;
  error: string | null;
  selectedStations: string[];
  selectedVariables: string[];
  dateFrom: string;
  dateTo: string;
  limit: number;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onToggleStation: (stationCode: string) => void;
  onToggleVariable: (variableCode: string) => void;
  onRunQuery: () => Promise<void>;
}

function DataManagerPanel({
  filters,
  rows,
  loading,
  querying,
  error,
  selectedStations,
  selectedVariables,
  dateFrom,
  dateTo,
  limit,
  onDateFromChange,
  onDateToChange,
  onLimitChange,
  onToggleStation,
  onToggleVariable,
  onRunQuery,
}: DataManagerPanelProps) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-[#f8fbff] px-4 py-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-[#509EE3]" />
          Cargando filtros del Data Manager...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Consulta lectora de `measurements` usando solo variable, estación y rango de fechas.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="manager-date-from" className="text-xs text-muted-foreground">
            Fecha desde
          </Label>
          <Input
            id="manager-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="manager-date-to" className="text-xs text-muted-foreground">
            Fecha hasta
          </Label>
          <Input
            id="manager-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="manager-limit" className="text-xs text-muted-foreground">
            Límite de filas
          </Label>
          <Input
            id="manager-limit"
            type="number"
            min={100}
            max={5000}
            step={100}
            value={limit}
            onChange={(event) => onLimitChange(Math.max(100, Math.min(5000, Number(event.target.value || 100))))}
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Variables</Label>
        <div className="flex flex-wrap gap-1.5 rounded-md border bg-[#f8fbff] p-2 max-h-[112px] overflow-auto">
          {(filters?.variables ?? []).map((variable) => {
            const active = selectedVariables.includes(variable.code);
            return (
              <button
                key={variable.code}
                type="button"
                onClick={() => onToggleVariable(variable.code)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? 'border-[#509EE3] bg-[#509EE3] text-white'
                    : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                }`}
                title={variable.name}
              >
                {variable.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Estaciones</Label>
        <div className="flex flex-wrap gap-1.5 rounded-md border bg-[#f8fbff] p-2 max-h-[112px] overflow-auto">
          {(filters?.stations ?? []).map((station) => {
            const active = selectedStations.includes(station.code);
            return (
              <button
                key={station.code}
                type="button"
                onClick={() => onToggleStation(station.code)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? 'border-[#509EE3] bg-[#509EE3] text-white'
                    : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                }`}
                title={station.name}
              >
                {station.code}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Badge className="bg-[#e9f3fd] text-[#1F5A8A] border border-[#509EE3]/25 hover:bg-[#e9f3fd]">
          {rows.length.toLocaleString()} filas en la vista actual
        </Badge>
        <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" onClick={() => void onRunQuery()} disabled={querying}>
          {querying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
          Consultar
        </Button>
      </div>

      {error && <p className="text-sm text-[#1F5A8A]">{error}</p>}

      <div className="max-h-[360px] overflow-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#f8fbff] border-b">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Estación</th>
              <th className="px-3 py-2 text-left">Variable</th>
              <th className="px-3 py-2 text-left">Valor</th>
              <th className="px-3 py-2 text-left">Unidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Ejecuta una consulta para revisar datos.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={`${row.observed_at}-${row.station_code}-${row.variable_code}-${index}`} className="border-b last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(row.observed_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{row.station_code}</td>
                  <td className="px-3 py-2">{row.variable_name || row.variable_code}</td>
                  <td className="px-3 py-2">{row.value}</td>
                  <td className="px-3 py-2">{row.unit ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="p-3 bg-white rounded-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      <div className="flex items-center gap-1 mt-1">
        <TrendingUp className="w-3 h-3 text-green-600" />
        <p className="text-xs text-green-600">{hint}</p>
      </div>
    </div>
  );
}

function ValidationStep({
  runs,
  latestRun,
  loading,
  previewRows,
}: {
  runs: {
    id: string;
    status: string;
    started_at: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
  }[];
  latestRun: {
    status: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
  } | null;
  loading: boolean;
  previewRows: {
    observed_at: string;
    station_code: string;
    variable_code: string;
    value: number;
    unit: string | null;
    source_file_name: string;
  }[];
}) {
  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Data Validation</CardTitle>
          <CardDescription>Validación de corridas ETL y control de integridad</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Cargando historial ETL...</p>}

          {!loading && latestRun && (
            <div className="mb-4 p-4 bg-[#F9FBFC] border border-border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                {latestRun.status === 'completed' ? (
                  <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Last run completed
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Last run failed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Insertados: {latestRun.records_inserted} | Actualizados: {latestRun.records_updated} | Omitidos:{' '}
                {latestRun.records_skipped}
              </p>
            </div>
          )}

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F9FBFC] border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Run ID</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Started</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Inserted</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Updated</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border hover:bg-[#F9FBFC]/50">
                      <td className="px-4 py-3 font-mono text-xs">{run.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3">{new Date(run.started_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Badge variant={run.status === 'completed' ? 'outline' : 'destructive'}>{run.status}</Badge>
                      </td>
                      <td className="px-4 py-3">{run.records_inserted}</td>
                      <td className="px-4 py-3">{run.records_updated}</td>
                      <td className="px-4 py-3">{run.records_skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {runs.length === 0 && !loading && (
            <p className="mt-4 text-sm text-muted-foreground">No hay corridas ETL aún.</p>
          )}

          <div className="mt-6">
            <h4 className="font-medium mb-2">Previsualización de datos cargados</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F9FBFC] border-b border-border sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fecha/Hora</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Estación</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Variable</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Valor</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Unidad</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Archivo fuente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr key={`${row.observed_at}-${row.station_code}-${row.variable_code}-${index}`} className="border-b border-border">
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(row.observed_at).toLocaleString()}</td>
                        <td className="px-3 py-2">{row.station_code}</td>
                        <td className="px-3 py-2">{row.variable_code}</td>
                        <td className="px-3 py-2">{row.value}</td>
                        <td className="px-3 py-2">{row.unit ?? '-'}</td>
                        <td className="px-3 py-2 text-xs">{row.source_file_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {previewRows.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground mt-2">
                Sin filas para previsualizar. Si la corrida fue exitosa pero quedó en cero, revisa mapeo de fecha y estaciones.
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
              <Settings className="w-4 h-4 mr-2" />
              Validation Rules Applied
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MappingStep({
  previewRows,
}: {
  previewRows: {
    observed_at: string;
    station_code: string;
    variable_code: string;
    value: number;
    unit: string | null;
    source_file_name: string;
  }[];
}) {
  const baseRows = useMemo(
    () =>
      previewRows.map((row) => ({
        observed_at: row.observed_at,
        station_code: row.station_code,
        variable_code: row.variable_code,
        value: row.value,
        unit: row.unit ?? '',
        source_file_name: row.source_file_name,
      })),
    [previewRows],
  );

  const allColumns = useMemo(() => {
    const firstRow = baseRows[0];
    return firstRow ? Object.keys(firstRow) : [];
  }, [baseRows]);

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [numericColumns, setNumericColumns] = useState<string[]>([]);
  const [samplePct, setSamplePct] = useState(100);
  const [dateColumn, setDateColumn] = useState('observed_at');
  const [extractDateFeatures, setExtractDateFeatures] = useState(false);
  const [dropMissingRows, setDropMissingRows] = useState(false);
  const [imputeMissingValues, setImputeMissingValues] = useState(false);

  useEffect(() => {
    if (allColumns.length === 0) {
      return;
    }

    setSelectedColumns((current) => {
      if (current.length === 0) {
        return allColumns;
      }
      const filtered = current.filter((column) => allColumns.includes(column));
      return filtered.length > 0 ? filtered : allColumns;
    });

    setNumericColumns((current) => {
      const filtered = current.filter((column) => allColumns.includes(column));
      if (filtered.length > 0) {
        return filtered;
      }
      return allColumns.includes('value') ? ['value'] : [];
    });

    setDateColumn((current) => (allColumns.includes(current) ? current : allColumns[0] ?? ''));
  }, [allColumns]);

  const toggleSelectedColumn = (column: string) => {
    setSelectedColumns((current) => {
      if (current.includes(column)) {
        const next = current.filter((item) => item !== column);
        return next.length > 0 ? next : current;
      }
      return [...current, column];
    });
    setNumericColumns((current) => current.filter((item) => item !== column));
  };

  const toggleNumericColumn = (column: string) => {
    if (!selectedColumns.includes(column)) {
      return;
    }
    setNumericColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    );
  };

  const processedRows = useMemo(() => {
    if (selectedColumns.length === 0) {
      return [] as Record<string, string | number | null>[];
    }

    const categoricalColumns = selectedColumns.filter((column) => !numericColumns.includes(column));
    let rows: Record<string, string | number | null>[] = baseRows.map((row) => {
      const output: Record<string, string | number | null> = {};
      for (const column of selectedColumns) {
        const rawValue = (row as Record<string, unknown>)[column];
        if (numericColumns.includes(column)) {
          if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
            output[column] = null;
          } else {
            const parsed = Number(rawValue);
            output[column] = Number.isFinite(parsed) ? parsed : null;
          }
        } else {
          output[column] = rawValue === null || rawValue === undefined ? null : String(rawValue);
        }
      }
      return output;
    });

    if (dropMissingRows) {
      rows = rows.filter((row) =>
        selectedColumns.every((column) => {
          const value = row[column];
          if (value === null || value === undefined) {
            return false;
          }
          return String(value).trim() !== '';
        }),
      );
    }

    if (imputeMissingValues) {
      const numericMeans = new Map<string, number>();
      for (const column of numericColumns) {
        const values = rows
          .map((row) => row[column])
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        const mean = values.length > 0 ? values.reduce((accumulator, value) => accumulator + value, 0) / values.length : 0;
        numericMeans.set(column, mean);
      }

      const categoricalModes = new Map<string, string>();
      for (const column of categoricalColumns) {
        const counts = new Map<string, number>();
        for (const row of rows) {
          const value = row[column];
          if (typeof value === 'string' && value.trim() !== '') {
            counts.set(value, (counts.get(value) ?? 0) + 1);
          }
        }
        const mode = Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? '';
        categoricalModes.set(column, mode);
      }

      rows = rows.map((row) => {
        const output = { ...row };
        for (const column of numericColumns) {
          if (output[column] === null || output[column] === undefined) {
            output[column] = numericMeans.get(column) ?? 0;
          }
        }
        for (const column of categoricalColumns) {
          const current = output[column];
          if (current === null || current === undefined || String(current).trim() === '') {
            output[column] = categoricalModes.get(column) ?? '';
          }
        }
        return output;
      });
    }

    if (extractDateFeatures && dateColumn && selectedColumns.includes(dateColumn)) {
      rows = rows.map((row) => {
        const output = { ...row };
        const rawValue = row[dateColumn];
        const parsed = new Date(String(rawValue ?? ''));
        if (Number.isFinite(parsed.getTime())) {
          output.year = parsed.getUTCFullYear();
          output.month = parsed.getUTCMonth() + 1;
          output.day = parsed.getUTCDate();
          output.hour = parsed.getUTCHours();
          output.weekday = parsed.getUTCDay();
        } else {
          output.year = null;
          output.month = null;
          output.day = null;
          output.hour = null;
          output.weekday = null;
        }
        return output;
      });
    }

    if (samplePct < 100 && rows.length > 0) {
      const targetRows = Math.max(1, Math.floor((rows.length * samplePct) / 100));
      const stride = Math.max(1, Math.floor(rows.length / targetRows));
      rows = rows.filter((_, index) => index % stride === 0).slice(0, targetRows);
    }

    return rows;
  }, [
    baseRows,
    dateColumn,
    dropMissingRows,
    extractDateFeatures,
    imputeMissingValues,
    numericColumns,
    samplePct,
    selectedColumns,
  ]);

  const previewColumns = useMemo(() => {
    const firstRow = processedRows[0];
    return firstRow ? Object.keys(firstRow) : [];
  }, [processedRows]);

  const csvData = useMemo(() => {
    if (processedRows.length === 0 || previewColumns.length === 0) {
      return '';
    }
    const header = previewColumns.join(',');
    const lines = processedRows.map((row) =>
      previewColumns
        .map((column) => {
          const value = row[column];
          const text = value === null || value === undefined ? '' : String(value);
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(','),
    );
    return [header, ...lines].join('\n');
  }, [previewColumns, processedRows]);

  const csvHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(csvData)}`,
    [csvData],
  );

  const categoricalColumns = selectedColumns.filter((column) => !numericColumns.includes(column));

  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Field Mapping</CardTitle>
          <CardDescription>
            Ajusta columnas, tipos, muestreo, fechas e imputación sobre la muestra ETL para validar el mapeo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            {[
              { source: 'fecha/hora', target: 'observed_at', type: 'datetime' },
              { source: 'estacion', target: 'station.code', type: 'string' },
              { source: 'contaminante/variable', target: 'variable.code', type: 'string' },
              { source: 'valor', target: 'measurement.value', type: 'float' },
              { source: 'unidad', target: 'measurement.unit', type: 'string' },
            ].map((mapping) => (
              <div key={mapping.source} className="flex items-center gap-4 p-4 bg-[#F9FBFC] rounded-lg">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Source Field</Label>
                  <p className="font-medium">{mapping.source}</p>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Target Field</Label>
                  <p className="font-medium">{mapping.target}</p>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">Data Type</Label>
                  <Badge variant="outline">{mapping.type}</Badge>
                </div>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="text-sm font-medium">Column Selection</Label>
            <div className="flex flex-wrap gap-2 rounded-lg border bg-[#F9FBFC] p-3">
              {allColumns.map((column) => {
                const active = selectedColumns.includes(column);
                return (
                  <button
                    key={`column-${column}`}
                    type="button"
                    onClick={() => toggleSelectedColumn(column)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? 'border-[#509EE3] bg-[#509EE3] text-white'
                        : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                    }`}
                  >
                    {column}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Numeric Variables</Label>
              <div className="flex flex-wrap gap-2 rounded-lg border bg-[#F9FBFC] p-3 min-h-16">
                {selectedColumns.map((column) => {
                  const active = numericColumns.includes(column);
                  return (
                    <button
                      key={`numeric-${column}`}
                      type="button"
                      onClick={() => toggleNumericColumn(column)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? 'border-[#509EE3] bg-[#509EE3] text-white'
                          : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                      }`}
                    >
                      {column}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium">Categorical Variables</Label>
              <div className="flex flex-wrap gap-2 rounded-lg border bg-[#F9FBFC] p-3 min-h-16">
                {categoricalColumns.length === 0 && (
                  <span className="text-xs text-muted-foreground">No categorical variables selected.</span>
                )}
                {categoricalColumns.map((column) => (
                  <Badge key={`categorical-${column}`} variant="outline">
                    {column}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sample-pct" className="text-xs text-muted-foreground">
                Subsample (%)
              </Label>
              <Input
                id="sample-pct"
                type="number"
                min={1}
                max={100}
                value={samplePct}
                onChange={(event) =>
                  setSamplePct(Math.max(1, Math.min(100, Number(event.target.value || 100))))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-column" className="text-xs text-muted-foreground">
                Date column
              </Label>
              <Select value={dateColumn} onValueChange={setDateColumn}>
                <SelectTrigger id="date-column">
                  <SelectValue placeholder="Select date column..." />
                </SelectTrigger>
                <SelectContent>
                  {selectedColumns.map((column) => (
                    <SelectItem key={`date-col-${column}`} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date features</Label>
              <button
                type="button"
                onClick={() => setExtractDateFeatures((current) => !current)}
                className={`h-10 w-full rounded-md border text-xs font-medium transition-colors ${
                  extractDateFeatures
                    ? 'border-[#509EE3] bg-[#509EE3] text-white'
                    : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                }`}
              >
                {extractDateFeatures ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDropMissingRows((current) => !current)}
              className={`h-10 rounded-md border text-xs font-medium transition-colors ${
                dropMissingRows
                  ? 'border-[#509EE3] bg-[#509EE3] text-white'
                  : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
              }`}
            >
              {dropMissingRows ? 'Drop rows with missing values: on' : 'Drop rows with missing values: off'}
            </button>
            <button
              type="button"
              onClick={() => setImputeMissingValues((current) => !current)}
              className={`h-10 rounded-md border text-xs font-medium transition-colors ${
                imputeMissingValues
                  ? 'border-[#509EE3] bg-[#509EE3] text-white'
                  : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
              }`}
            >
              {imputeMissingValues ? 'Impute missing values: on' : 'Impute missing values: off'}
            </button>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Processed Preview ({processedRows.length.toLocaleString()} rows)
              </Label>
              <a href={csvHref} download="mapped_preview.csv">
                <Button size="sm" className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" disabled={!csvData}>
                  <Download className="w-4 h-4 mr-2" />
                  Download CSV
                </Button>
              </a>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F9FBFC] border-b border-border sticky top-0">
                    <tr>
                      {previewColumns.map((column) => (
                        <th key={`preview-head-${column}`} className="px-3 py-2 text-left font-medium text-muted-foreground">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {processedRows.slice(0, 120).map((row, index) => (
                      <tr key={`processed-row-${index}`} className="border-b border-border">
                        {previewColumns.map((column) => (
                          <td key={`processed-${index}-${column}`} className="px-3 py-2">
                            {row[column] === null || row[column] === undefined ? '' : String(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {processedRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay datos disponibles para previsualización. Ejecuta una corrida ETL primero.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
