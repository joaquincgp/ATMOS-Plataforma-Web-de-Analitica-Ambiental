import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileText,
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
import { useEtl } from '@/hooks/use-etl';
import { REMMAQ_VARIABLE_OPTIONS } from '@/api/modules/etl';

interface StepperProps {
  currentStep: number;
  onStepClick: (step: number) => void;
}

function Stepper({ currentStep, onStepClick }: StepperProps) {
  const steps = [
    { number: 1, label: 'Source', description: 'Select data source' },
    { number: 2, label: 'Validation', description: 'Validate ETL results' },
    { number: 3, label: 'Mapping', description: 'Contract mapping' },
    { number: 4, label: 'Commit', description: 'Operational status' },
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
  const [maxArchivesPerRun, setMaxArchivesPerRun] = useState<number>(2);
  const [actionMessage, setActionMessage] = useState<StepMessage | null>(null);
  const [processingAction, setProcessingAction] = useState<'db' | 'sync' | 'upload' | null>(null);

  const {
    runs,
    metrics,
    previewRows,
    loading,
    refreshing,
    error,
    initDatabase,
    triggerRemmaqSync,
    uploadManualFile,
    refresh,
  } = useEtl();

  const latestRun = useMemo(() => runs[0] ?? null, [runs]);

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

  const handleInitializeDb = async () => {
    setProcessingAction('db');
    setActionMessage(null);

    try {
      const response = await initDatabase();
      setActionMessage({
        type: 'success',
        text: `Base inicializada correctamente (${response.timestamp}).`,
      });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo inicializar la base de datos.',
      });
    } finally {
      setProcessingAction(null);
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
        maxArchives: maxArchivesPerRun,
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
    if (currentStep < 4) {
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
      return [...current, code];
    });
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

        {(error || actionMessage) && (
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
              maxArchivesPerRun={maxArchivesPerRun}
              onToggleVariable={toggleVariable}
              onChangeMaxArchivesPerRun={setMaxArchivesPerRun}
              onInitializeDb={handleInitializeDb}
              onSyncRemmaq={handleSyncRemmaq}
              onUploadManual={handleManualUpload}
            />
          )}

          {currentStep === 2 && (
            <ValidationStep runs={runs} latestRun={latestRun} loading={loading} previewRows={previewRows} />
          )}

          {currentStep === 3 && <MappingStep />}

          {currentStep === 4 && (
            <CommitStep
              metrics={metrics}
              latestRun={latestRun}
              refreshing={refreshing}
              onRefresh={refresh}
            />
          )}
        </div>

        <div className="max-w-7xl mx-auto mt-6 flex justify-between">
          <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1}>
            Previous
          </Button>
          <Button
            onClick={handleNext}
            disabled={currentStep === 4}
            className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
          >
            {currentStep === 4 ? 'Finish' : 'Next'}
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
    started_at: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    status: string;
  } | null;
  loading: boolean;
  processingAction: 'db' | 'sync' | 'upload' | null;
  selectedVariables: string[];
  maxArchivesPerRun: number;
  onToggleVariable: (code: string) => void;
  onChangeMaxArchivesPerRun: (value: number) => void;
  onInitializeDb: () => Promise<void>;
  onSyncRemmaq: () => Promise<void>;
  onUploadManual: () => Promise<void>;
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
  maxArchivesPerRun,
  onToggleVariable,
  onChangeMaxArchivesPerRun,
  onInitializeDb,
  onSyncRemmaq,
  onUploadManual,
}: SourceStepProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Select Data Source</CardTitle>
          <CardDescription>Selecciona REMMAQ automático o carga manual</CardDescription>
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
              <p className="text-xs text-muted-foreground">CSV, XLSX o TXT</p>
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
              <p className="text-xs text-muted-foreground">Página estática + ETL por lotes</p>
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
              <h3 className="font-semibold mb-1">Database Init</h3>
              <p className="text-xs text-muted-foreground">Inicialización desde código</p>
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
            </div>
          )}

          {sourceType === 'remmaq' && (
            <div className="space-y-6 border-2 border-[#509EE3]/20 rounded-lg p-6 bg-[#509EE3]/5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium block">Variables REMMAQ a procesar</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-white rounded-lg border">
                    {REMMAQ_VARIABLE_OPTIONS.map((option) => (
                      <label key={option.code} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedVariables.includes(option.code)}
                          onChange={() => onToggleVariable(option.code)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Sugerido: cargar 1 a 3 variables por corrida.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-archives" className="text-sm font-medium block">
                    Cantidad de enlaces REMMAQ por corrida
                  </Label>
                  <input
                    id="max-archives"
                    type="number"
                    min={1}
                    max={30}
                    value={maxArchivesPerRun}
                    onChange={(event) => onChangeMaxArchivesPerRun(Math.max(1, Number(event.target.value || 1)))}
                    className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                  />
                  <p className="text-xs text-muted-foreground">
                    Cada enlace corresponde a un archivo histórico (por variable). Usa valores bajos para ejecutar por partes.
                  </p>
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
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Inicializa el esquema completo (`stations`, `variables`, `measurements`, `etl_runs`, `source_files`) desde código.
              </p>
              <div className="flex justify-end">
                <Button
                  className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                  onClick={() => void onInitializeDb()}
                  disabled={processingAction === 'db'}
                >
                  <Database className="w-4 h-4 mr-2" />
                  {processingAction === 'db' ? 'Initializing...' : 'Initialize Database'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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
  runs: Array<{
    id: string;
    status: string;
    started_at: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
  }>;
  latestRun: {
    status: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
  } | null;
  loading: boolean;
  previewRows: Array<{
    observed_at: string;
    station_code: string;
    variable_code: string;
    value: number;
    unit: string | null;
    source_file_name: string;
  }>;
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

function MappingStep() {
  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Field Mapping</CardTitle>
          <CardDescription>Contrato analítico para datos normalizados</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
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
        </CardContent>
      </Card>
    </div>
  );
}

function CommitStep({
  metrics,
  latestRun,
  refreshing,
  onRefresh,
}: {
  metrics: { total_measurements: number; total_stations: number; total_variables: number; latest_run_status: string } | null;
  latestRun: {
    status: string;
    started_at: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
  } | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Review & Commit</CardTitle>
          <CardDescription>Estado operativo del ETL en producción</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Total Measurements</Label>
                <p className="font-medium">{metrics ? metrics.total_measurements.toLocaleString() : '--'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Stations</Label>
                <p className="font-medium">{metrics ? metrics.total_stations : '--'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Variables</Label>
                <p className="font-medium">{metrics ? metrics.total_variables : '--'}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Latest Run</Label>
                <p className="font-medium">{latestRun ? new Date(latestRun.started_at).toLocaleString() : 'No runs yet'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Latest Status</Label>
                <Badge variant={latestRun?.status === 'completed' ? 'outline' : 'destructive'}>
                  {latestRun?.status ?? 'unknown'}
                </Badge>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Last Delta</Label>
                <p className="font-medium">
                  +{latestRun?.records_inserted ?? 0} / ~{latestRun?.records_updated ?? 0} / ={latestRun?.records_skipped ?? 0}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between bg-[#F9FBFC] p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Pipeline listo</p>
                <p className="text-xs text-muted-foreground">
                  ETL consolidado para REMMAQ (archivos estáticos) y cargas manuales.
                </p>
              </div>
            </div>
            <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white" onClick={() => void onRefresh()}>
              <Download className="w-4 h-4 mr-2" />
              {refreshing ? 'Refreshing...' : 'Refresh Status'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
