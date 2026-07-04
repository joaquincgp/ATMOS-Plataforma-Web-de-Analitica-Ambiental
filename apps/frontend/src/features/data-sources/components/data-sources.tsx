import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  exportAnalyticsQuery,
  getAnalyticsFilters,
  runAnalyticsQuery,
  type AnalyticsDataRow,
  type AnalyticsFilterOptionsResponse,
} from '@/api/modules/analytics';
import { getAppConfig } from '@/api/modules/app-config';
import {
  deleteManualDataset,
  downloadManualDataset,
  listManualDatasets,
  REMMAQ_VARIABLE_OPTIONS,
  type EtlPreviewRowResponse,
  type EtlRunResponse,
  type ManualDatasetResponse,
} from '@/api/modules/etl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useWorkspace } from '@/contexts/workspace-context';
import { useAnalyticalWorkspaceState } from '@/features/analysis/contexts/analytical-workspace-context';
import { ManualDataIngestionWizard } from '@/features/data-sources/components/manual-data-ingestion-wizard';
import { useEtl } from '@/hooks/use-etl';
import { formatEcuadorDateTime, parseBackendDateInEcuador } from '@/shared/lib/datetime';

const MAX_REMMAQ_VARIABLES = 3;
const FALLBACK_QUERY_LIMIT = 5000;

type SourceMode = 'manual' | 'sync' | 'existing';

interface StepMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

interface PreviewMeasurementRow {
  observed_at: string;
  station_code: string;
  variable_code: string;
  value: number;
  unit: string | null;
  source_file_name: string;
}

interface StepperProps {
  currentStep: number;
  onStepClick: (step: number) => void;
}

function Stepper({ currentStep, onStepClick }: StepperProps) {
  const steps = [
    { number: 1, label: 'Source', description: 'Choose data' },
    { number: 2, label: 'Mapping', description: 'Review fields' },
    { number: 3, label: 'Summary', description: 'Check result' },
  ];

  return (
    <div className="w-full py-6">
      <div className="mx-auto flex max-w-4xl justify-between relative">
        <div className="absolute top-6 left-[15%] right-[15%] h-0.5 bg-gray-200" />
        {steps.map((step, index) => (
          <div key={step.number} className="relative z-10 flex flex-1 flex-col items-center">
            {index < steps.length - 1 && (
              <div 
                className={`absolute top-6 left-[50%] w-full h-0.5 transition-colors duration-300 ${
                  currentStep > step.number ? 'bg-[#509EE3]' : 'bg-transparent'
                }`} 
              />
            )}
            <button
              type="button"
              onClick={() => onStepClick(step.number)}
              className={`
                relative z-20 flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200
                ${
                  currentStep > step.number
                    ? 'bg-[#509EE3] text-white'
                    : currentStep === step.number
                      ? 'bg-[#509EE3] text-white ring-4 ring-[#509EE3]/20'
                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                }
              `}
            >
              {currentStep > step.number ? <Check className="h-6 w-6" /> : step.number}
            </button>
            <div className="mt-2 text-center bg-white px-2">
              <p className={`text-sm font-medium ${currentStep >= step.number ? 'text-foreground' : 'text-muted-foreground'}`}>
                {step.label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function clampRowLimit(value: number, maxLimit: number) {
  return Math.max(100, Math.min(maxLimit, Math.floor(value || 100)));
}

export function DataSources({ onOpenAnalytics }: { onOpenAnalytics?: () => void }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceMode>('manual');
  const [selectedVariables, setSelectedVariables] = useState<string[]>(['PM25']);
  const [remmaqDateFrom, setRemmaqDateFrom] = useState('');
  const [remmaqDateTo, setRemmaqDateTo] = useState('');
  const [remmaqForceReprocess, setRemmaqForceReprocess] = useState(false);
  const [actionMessage, setActionMessage] = useState<StepMessage | null>(null);
  const [processingAction, setProcessingAction] = useState<'sync' | null>(null);
  const [managerFilters, setManagerFilters] = useState<AnalyticsFilterOptionsResponse | null>(null);
  const [managerRows, setManagerRows] = useState<AnalyticsDataRow[]>([]);
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerQuerying, setManagerQuerying] = useState(false);
  const [managerExporting, setManagerExporting] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerSelectedSourceFiles, setManagerSelectedSourceFiles] = useState<number[]>([]);
  const [managerSelectedStations, setManagerSelectedStations] = useState<string[]>([]);
  const [managerSelectedVariables, setManagerSelectedVariables] = useState<string[]>([]);
  const [managerDateFrom, setManagerDateFrom] = useState('');
  const [managerDateTo, setManagerDateTo] = useState('');
  const [managerMaxLimit, setManagerMaxLimit] = useState(FALLBACK_QUERY_LIMIT);
  const [managerLimit, setManagerLimit] = useState(FALLBACK_QUERY_LIMIT);
  const [manualDataset, setManualDataset] = useState<ManualDatasetResponse | null>(null);
  const [manualDatasets, setManualDatasets] = useState<ManualDatasetResponse[]>([]);
  const [manualDatasetsLoading, setManualDatasetsLoading] = useState(false);
  const [manualDatasetsError, setManualDatasetsError] = useState<string | null>(null);
  const [selectedExistingDatasetId, setSelectedExistingDatasetId] = useState<string | null>(null);
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [downloadingDatasetId, setDownloadingDatasetId] = useState<string | null>(null);
  const [clearingRunHistory, setClearingRunHistory] = useState(false);

  const { runs, currentRun, metrics, previewRows, loading, refreshing, error, triggerRemmaqSync, clearRunHistory } =
    useEtl();
  const { activeWorkspaceId } = useWorkspace();
  const {
    setSelectedSourceIds,
    setSelectedManualDatasetId,
    setSelectedStations,
    setSelectedVariables: setAnalysisSelectedVariables,
    setDateFrom,
    setDateTo,
    setRangePreset,
    setRowLimit,
    setPlotViewport,
    setGranularity,
  } = useAnalyticalWorkspaceState();

  useEffect(() => {
    const loadQueryLimitConfig = async () => {
      try {
        const response = await getAppConfig();
        const configuredLimit = response.items.find((item) => item.key === 'analytics.default_query_limit')?.value;
        if (typeof configuredLimit !== 'number') {
          return;
        }
        const nextLimit = Math.max(100, Math.floor(configuredLimit));
        setManagerMaxLimit(nextLimit);
        setManagerLimit(nextLimit);
      } catch {
        // Keep the compiled fallback if config is temporarily unavailable.
      }
    };
    void loadQueryLimitConfig();
  }, []);

  const latestRun = useMemo(() => currentRun ?? runs[0] ?? null, [currentRun, runs]);
  const finalizedManualDatasets = useMemo(
    () => manualDatasets.filter((dataset) => dataset.status.startsWith('finalized')),
    [manualDatasets],
  );
  const selectedExistingDataset = useMemo(
    () => finalizedManualDatasets.find((dataset) => dataset.id === selectedExistingDatasetId) ?? null,
    [finalizedManualDatasets, selectedExistingDatasetId],
  );
  const existingQueryPreviewRows = useMemo<PreviewMeasurementRow[]>(
    () =>
      managerRows.map((row) => ({
        observed_at: row.observed_at,
        station_code: row.station_code,
        variable_code: row.variable_code,
        value: row.value,
        unit: row.unit,
        source_file_name: row.source_file_name,
      })),
    [managerRows],
  );

  const upsertManualDataset = useCallback((nextDataset: ManualDatasetResponse) => {
    setManualDatasets((current) => {
      const withoutCurrent = current.filter((dataset) => dataset.id !== nextDataset.id);
      return [nextDataset, ...withoutCurrent].sort(
        (left, right) =>
          parseBackendDateInEcuador(right.updated_at).getTime() - parseBackendDateInEcuador(left.updated_at).getTime(),
      );
    });
  }, []);

  const handleManualDatasetChange = useCallback(
    (nextDataset: ManualDatasetResponse | null) => {
      setManualDataset(nextDataset);
      if (nextDataset) {
        upsertManualDataset(nextDataset);
      }
    },
    [upsertManualDataset],
  );

  const handleExistingDatasetChange = useCallback(
    (nextDataset: ManualDatasetResponse | null) => {
      if (!nextDataset) {
        return;
      }
      upsertManualDataset(nextDataset);
      setSelectedExistingDatasetId(nextDataset.id);
    },
    [upsertManualDataset],
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      setManualDatasets([]);
      setManualDatasetsError(null);
      return;
    }

    let cancelled = false;

    const loadManualDatasets = async () => {
      setManualDatasetsLoading(true);
      setManualDatasetsError(null);
      try {
        const nextDatasets = await listManualDatasets(activeWorkspaceId);
        if (!cancelled) {
          setManualDatasets(nextDatasets);
        }
      } catch (err) {
        if (!cancelled) {
          setManualDatasetsError(err instanceof Error ? err.message : 'Could not load saved datasets.');
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
    if (sourceType !== 'existing' || managerLoading || managerFilters) {
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
        setManagerError(err instanceof Error ? err.message : 'Could not load filters.');
      } finally {
        setManagerLoading(false);
      }
    };

    void loadManagerFilters();
  }, [managerFilters, managerLoading, sourceType]);

  const handleSyncRemmaq = async () => {
    if (selectedVariables.length === 0) {
      setActionMessage({ type: 'error', text: 'Select at least one variable.' });
      return;
    }

    setProcessingAction('sync');
    setActionMessage(null);

    try {
      const run = await triggerRemmaqSync({
        forceReprocess: remmaqForceReprocess,
        variableCodes: selectedVariables,
        observedFrom: remmaqDateFrom || undefined,
        observedTo: remmaqDateTo || undefined,
      });
      setActionMessage({
        type: 'success',
        text: run.status === 'completed' ? 'REMMAQ sync completed.' : `REMMAQ sync ended with status: ${run.status}.`,
      });
      setCurrentStep(3);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Sync failed.',
      });
    } finally {
      setProcessingAction(null);
    }
  };

  const handleRunManagerQuery = async () => {
    setManagerQuerying(true);
    setManagerError(null);
    setSelectedExistingDatasetId(null);
    try {
      const response = await runAnalyticsQuery({
        source_file_ids: managerSelectedSourceFiles.length > 0 ? managerSelectedSourceFiles : undefined,
        station_codes: managerSelectedStations.length > 0 ? managerSelectedStations : undefined,
        variable_codes: managerSelectedVariables.length > 0 ? managerSelectedVariables : undefined,
        date_from: managerDateFrom || undefined,
        date_to: managerDateTo || undefined,
        limit: clampRowLimit(managerLimit, managerMaxLimit),
      });
      setManagerRows(response.rows);
      if (response.rows.length === 0) {
        setManagerError('No rows found for the current filters.');
      }
    } catch (err) {
      setManagerRows([]);
      setManagerError(err instanceof Error ? err.message : 'Query failed.');
    } finally {
      setManagerQuerying(false);
    }
  };

  const buildManagerQueryPayload = (includePreviewLimit: boolean) => ({
    source_file_ids: managerSelectedSourceFiles.length > 0 ? managerSelectedSourceFiles : undefined,
    station_codes: managerSelectedStations.length > 0 ? managerSelectedStations : undefined,
    variable_codes: managerSelectedVariables.length > 0 ? managerSelectedVariables : undefined,
    date_from: managerDateFrom || undefined,
    date_to: managerDateTo || undefined,
    limit: includePreviewLimit ? clampRowLimit(managerLimit, managerMaxLimit) : undefined,
  });

  const handleExportManagerQuery = async () => {
    setManagerExporting(true);
    setManagerError(null);
    try {
      const { blob, filename } = await exportAnalyticsQuery(buildManagerQueryPayload(false));
      const selectedSources = (managerFilters?.sources ?? []).filter((source) =>
        managerSelectedSourceFiles.includes(source.id),
      );
      const exportFilename =
        selectedSources.length === 1
          ? toCsvDownloadFilename(selectedSources[0].name, filename)
          : selectedSources.length > 1
            ? toCsvDownloadFilename(`${selectedSources[0].name} + ${selectedSources.length - 1} more`, filename)
            : filename;
      downloadBlob(blob, exportFilename);
      setActionMessage({ type: 'success', text: 'Filtered records downloaded.' });
    } catch (err) {
      setManagerError(err instanceof Error ? err.message : 'Could not export records.');
    } finally {
      setManagerExporting(false);
    }
  };

  const handleSourceTypeChange = (nextSourceType: SourceMode) => {
    setSourceType(nextSourceType);
    setCurrentStep(1);
    setActionMessage(null);
  };

  const handleStepClick = (step: number) => {
    if ((sourceType === 'existing' || sourceType === 'sync') && step === 2) {
      setCurrentStep(3);
      return;
    }
    setCurrentStep(step);
  };

  const sourceReady =
    sourceType === 'manual'
      ? manualDataset !== null
      : sourceType === 'sync'
        ? latestRun !== null
        : selectedExistingDataset !== null || managerRows.length > 0;

  const summaryReady =
    sourceType === 'manual'
      ? manualDataset !== null
      : sourceType === 'sync'
        ? latestRun !== null
        : selectedExistingDataset !== null || managerRows.length > 0;

  const handleNext = () => {
    if (currentStep === 1 && !sourceReady) {
      setActionMessage({
        type: 'info',
        text:
          sourceType === 'manual'
            ? 'Load a dataset first.'
            : sourceType === 'sync'
              ? 'Run a REMMAQ sync first.'
              : 'Open a saved dataset or run a query first.',
      });
      return;
    }

    if (currentStep === 1 && (sourceType === 'existing' || sourceType === 'sync')) {
      setCurrentStep(3);
      return;
    }

    if (currentStep === 2 && !summaryReady) {
      setActionMessage({ type: 'info', text: 'There is no data to summarize yet.' });
      return;
    }

    if (currentStep < 3) {
      setCurrentStep((previous) => previous + 1);
    }
  };

  const handleOpenInAnalytics = async () => {
    try {
      if (sourceType === 'manual') {
        if (!manualDataset) {
          setActionMessage({ type: 'info', text: 'Load a dataset first.' });
          return;
        }
        setSelectedManualDatasetId(manualDataset.id);
        setSelectedSourceIds([]);
        setSelectedStations([]);
        setAnalysisSelectedVariables([]);
      } else if (sourceType === 'existing') {
        if (selectedExistingDataset) {
          setSelectedManualDatasetId(selectedExistingDataset.id);
          setSelectedSourceIds([]);
          setSelectedStations([]);
          setAnalysisSelectedVariables([]);
        } else {
          const selectedSourceIdsForAnalysis =
            managerSelectedSourceFiles.length > 0
              ? managerSelectedSourceFiles
              : Array.from(new Set(managerRows.map((row) => row.source_file_id)));
          if (selectedSourceIdsForAnalysis.length === 0) {
            setActionMessage({ type: 'info', text: 'Run a query or open a saved dataset first.' });
            return;
          }
          setSelectedManualDatasetId(null);
          setSelectedSourceIds(selectedSourceIdsForAnalysis);
          setSelectedStations(managerSelectedStations);
          setAnalysisSelectedVariables(managerSelectedVariables);
          setDateFrom(managerDateFrom);
          setDateTo(managerDateTo);
          setRangePreset(managerDateFrom || managerDateTo ? 'custom' : 'all');
          setRowLimit(clampRowLimit(managerLimit, managerMaxLimit));
        }
      } else {
        if (!latestRun) {
          setActionMessage({ type: 'info', text: 'Run a REMMAQ sync first.' });
          return;
        }
        const nextFilters = managerFilters ?? (await getAnalyticsFilters());
        const matchingSources = nextFilters.sources.filter((source) => source.etl_run_id === latestRun.id);
        if (matchingSources.length === 0) {
          setActionMessage({
            type: 'error',
            text: 'The synced REMMAQ source is not available yet in analytics filters.',
          });
          return;
        }
        setSelectedManualDatasetId(null);
        setSelectedSourceIds(matchingSources.map((source) => source.id));
        setSelectedStations([]);
        setAnalysisSelectedVariables(selectedVariables);
        setDateFrom(remmaqDateFrom);
        setDateTo(remmaqDateTo);
        setRangePreset(remmaqDateFrom || remmaqDateTo ? 'custom' : 'all');
        setRowLimit(clampRowLimit(matchingSources[0]?.row_count ?? managerMaxLimit, managerMaxLimit));
      }

      setGranularity('day');
      setPlotViewport({ from: null, to: null });
      onOpenAnalytics?.();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not open the source in Analytics.',
      });
    }
  };

  const handlePrevious = () => {
    if ((sourceType === 'existing' || sourceType === 'sync') && currentStep === 3) {
      setCurrentStep(1);
      return;
    }
    if (currentStep > 1) {
      setCurrentStep((previous) => previous - 1);
    }
  };

  useEffect(() => {
    if ((sourceType === 'existing' || sourceType === 'sync') && currentStep === 2) {
      setCurrentStep(3);
    }
  }, [currentStep, sourceType]);

  const toggleVariable = (code: string) => {
    setSelectedVariables((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code);
      }
      if (current.length >= MAX_REMMAQ_VARIABLES) {
        setActionMessage({ type: 'info', text: `Maximum ${MAX_REMMAQ_VARIABLES} variables per run.` });
        return current;
      }
      return [...current, code];
    });
  };

  useEffect(() => {
    if (!actionMessage && !error && !manualDatasetsError) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setActionMessage(null);
    }, 4500);
    return () => window.clearTimeout(timeout);
  }, [actionMessage, error, manualDatasetsError]);

  const toggleManagerSourceFile = (sourceFileId: number) => {
    setManagerSelectedSourceFiles((current) =>
      current.includes(sourceFileId)
        ? current.filter((item) => item !== sourceFileId)
        : [...current, sourceFileId],
    );
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

  const handleDeleteExistingDataset = async (datasetId: string) => {
    const dataset = manualDatasets.find((item) => item.id === datasetId);
    if (!dataset) {
      return;
    }
    const confirmed = window.confirm(`Delete "${dataset.name}"?`);
    if (!confirmed) {
      return;
    }

    setDeletingDatasetId(datasetId);
    setActionMessage(null);
    try {
      await deleteManualDataset(datasetId);
      setManualDatasets((current) => current.filter((item) => item.id !== datasetId));
      if (manualDataset?.id === datasetId) {
        setManualDataset(null);
      }
      if (selectedExistingDatasetId === datasetId) {
        setSelectedExistingDatasetId(null);
        setManagerRows([]);
      }
      setManagerFilters(null);
      setActionMessage({ type: 'success', text: 'Dataset deleted.' });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not delete the dataset.',
      });
    } finally {
      setDeletingDatasetId(null);
    }
  };

  const handleDownloadExistingDataset = async (datasetId: string) => {
    const dataset = manualDatasets.find((item) => item.id === datasetId);
    setDownloadingDatasetId(datasetId);
    setActionMessage(null);
    try {
      const { blob, filename } = await downloadManualDataset(datasetId);
      downloadBlob(blob, toCsvDownloadFilename(dataset?.name ?? filename, filename));
      setActionMessage({
        type: 'success',
        text: `Dataset "${dataset?.name ?? filename}" downloaded.`,
      });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not download the dataset.',
      });
    } finally {
      setDownloadingDatasetId(null);
    }
  };

  const handleClearRunHistory = async () => {
    const confirmed = window.confirm('Clear REMMAQ sync history from Data Manager? Loaded data will not be deleted.');
    if (!confirmed) {
      return;
    }

    setClearingRunHistory(true);
    setActionMessage(null);
    try {
      const cleared = await clearRunHistory();
      setActionMessage({ type: 'success', text: `Cleared ${cleared.toLocaleString()} history entries.` });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not clear ETL history.',
      });
    } finally {
      setClearingRunHistory(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      {(error !== null || actionMessage !== null || manualDatasetsError !== null) && (
        <FloatingNotification
          message={{
            type: error !== null || manualDatasetsError !== null ? 'error' : (actionMessage?.type ?? 'info'),
            text: error ?? manualDatasetsError ?? actionMessage?.text ?? '',
          }}
          onClose={() => setActionMessage(null)}
        />
      )}

      <div className="px-6 py-5">
        <div className="mb-5">
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Data Manager</h1>
          <p className="text-muted-foreground">Load, map, and review datasets.</p>
        </div>

        <Card className="mb-5 bg-white">
          <CardContent className="pt-6">
            <Stepper currentStep={currentStep} onStepClick={handleStepClick} />
          </CardContent>
        </Card>

        <div className="mx-auto max-w-7xl">
          {currentStep === 1 && (
            <SourceStep
              sourceType={sourceType}
              setSourceType={handleSourceTypeChange}
              activeWorkspaceId={activeWorkspaceId}
              manualDataset={manualDataset}
              latestRun={latestRun}
              onManualDatasetChange={handleManualDatasetChange}
              metrics={metrics}
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
              managerFilters={managerFilters}
              managerRows={managerRows}
              managerLoading={managerLoading}
              managerQuerying={managerQuerying}
              managerExporting={managerExporting}
              managerError={managerError}
              managerSelectedSourceFiles={managerSelectedSourceFiles}
              managerSelectedStations={managerSelectedStations}
              managerSelectedVariables={managerSelectedVariables}
              managerDateFrom={managerDateFrom}
              managerDateTo={managerDateTo}
              managerLimit={managerLimit}
              managerMaxLimit={managerMaxLimit}
              onManagerDateFromChange={setManagerDateFrom}
              onManagerDateToChange={setManagerDateTo}
              onManagerLimitChange={(value) => setManagerLimit(clampRowLimit(value, managerMaxLimit))}
              onManagerToggleSourceFile={toggleManagerSourceFile}
              onManagerToggleStation={toggleManagerStation}
              onManagerToggleVariable={toggleManagerVariable}
              onRunManagerQuery={handleRunManagerQuery}
              onExportManagerQuery={handleExportManagerQuery}
              manualDatasets={finalizedManualDatasets}
              manualDatasetsLoading={manualDatasetsLoading}
              selectedExistingDatasetId={selectedExistingDatasetId}
              deletingDatasetId={deletingDatasetId}
              downloadingDatasetId={downloadingDatasetId}
              onSelectExistingDataset={(datasetId) => {
                setSelectedExistingDatasetId(datasetId);
                setManagerRows([]);
                setManagerError(null);
              }}
              onDeleteDataset={handleDeleteExistingDataset}
              onDownloadDataset={handleDownloadExistingDataset}
              onNotify={setActionMessage}
            />
          )}

          {currentStep === 2 && (
            <MappingContent
              sourceType={sourceType}
              workspaceId={activeWorkspaceId}
              manualDataset={manualDataset}
              onManualDatasetChange={handleManualDatasetChange}
              existingDataset={selectedExistingDataset}
              onExistingDatasetChange={handleExistingDatasetChange}
              previewRows={sourceType === 'sync' ? previewRows : existingQueryPreviewRows}
              onNotify={setActionMessage}
            />
          )}

          {currentStep === 3 && (
            <SummaryContent
              sourceType={sourceType}
              manualDataset={manualDataset}
              existingDataset={selectedExistingDataset}
              runs={runs}
              latestRun={latestRun}
              loading={loading}
              clearingRunHistory={clearingRunHistory}
              onClearRunHistory={handleClearRunHistory}
              previewRows={previewRows}
              existingRows={managerRows}
            />
          )}
        </div>

        <div className="mx-auto mt-6 flex max-w-7xl justify-between">
          <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1}>
            Back
          </Button>
          <Button
            onClick={currentStep === 3 ? () => void handleOpenInAnalytics() : handleNext}
            className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90"
          >
            {currentStep === 3 ? 'Open in Analytics' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SourceStepProps {
  sourceType: SourceMode;
  setSourceType: (value: SourceMode) => void;
  activeWorkspaceId: string | null;
  manualDataset: ManualDatasetResponse | null;
  latestRun: EtlRunResponse | null;
  onManualDatasetChange: (dataset: ManualDatasetResponse | null) => void;
  metrics: { total_measurements: number; total_stations: number; total_variables: number; latest_run_status: string } | null;
  loading: boolean;
  processingAction: 'sync' | null;
  selectedVariables: string[];
  remmaqDateFrom: string;
  remmaqDateTo: string;
  remmaqForceReprocess: boolean;
  onRemmaqDateFromChange: (value: string) => void;
  onRemmaqDateToChange: (value: string) => void;
  onRemmaqForceReprocessChange: (value: boolean) => void;
  onToggleVariable: (code: string) => void;
  onSyncRemmaq: () => Promise<void>;
  managerFilters: AnalyticsFilterOptionsResponse | null;
  managerRows: AnalyticsDataRow[];
  managerLoading: boolean;
  managerQuerying: boolean;
  managerExporting: boolean;
  managerError: string | null;
  managerSelectedSourceFiles: number[];
  managerSelectedStations: string[];
  managerSelectedVariables: string[];
  managerDateFrom: string;
  managerDateTo: string;
  managerLimit: number;
  managerMaxLimit: number;
  onManagerDateFromChange: (value: string) => void;
  onManagerDateToChange: (value: string) => void;
  onManagerLimitChange: (value: number) => void;
  onManagerToggleSourceFile: (sourceFileId: number) => void;
  onManagerToggleStation: (stationCode: string) => void;
  onManagerToggleVariable: (variableCode: string) => void;
  onRunManagerQuery: () => Promise<void>;
  onExportManagerQuery: () => Promise<void>;
  manualDatasets: ManualDatasetResponse[];
  manualDatasetsLoading: boolean;
  selectedExistingDatasetId: string | null;
  deletingDatasetId: string | null;
  downloadingDatasetId: string | null;
  onSelectExistingDataset: (datasetId: string) => void;
  onDeleteDataset: (datasetId: string) => Promise<void>;
  onDownloadDataset: (datasetId: string) => Promise<void>;
  onNotify: (message: StepMessage) => void;
}

function SourceStep({
  sourceType,
  setSourceType,
  activeWorkspaceId,
  manualDataset,
  latestRun,
  onManualDatasetChange,
  metrics,
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
  managerFilters,
  managerRows,
  managerLoading,
  managerQuerying,
  managerExporting,
  managerError,
  managerSelectedSourceFiles,
  managerSelectedStations,
  managerSelectedVariables,
  managerDateFrom,
  managerDateTo,
  managerLimit,
  managerMaxLimit,
  onManagerDateFromChange,
  onManagerDateToChange,
  onManagerLimitChange,
  onManagerToggleSourceFile,
  onManagerToggleStation,
  onManagerToggleVariable,
  onRunManagerQuery,
  onExportManagerQuery,
  manualDatasets,
  manualDatasetsLoading,
  selectedExistingDatasetId,
  deletingDatasetId,
  downloadingDatasetId,
  onSelectExistingDataset,
  onDeleteDataset,
  onDownloadDataset,
  onNotify,
}: SourceStepProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Source</CardTitle>
          <CardDescription>Choose how you want to work with data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SourceCard
              active={sourceType === 'manual'}
              icon={Upload}
              title="Manual"
              description="Upload a file or use a raw link."
              onClick={() => setSourceType('manual')}
            />
            <SourceCard
              active={sourceType === 'sync'}
              icon={Server}
              title="Automatic"
              description="Run REMMAQ sync."
              onClick={() => setSourceType('sync')}
            />
            <SourceCard
              active={sourceType === 'existing'}
              icon={Database}
              title="Existing data"
              description="Open saved datasets or query stored measurements."
              onClick={() => setSourceType('existing')}
            />
          </div>

          <Separator />

          {sourceType === 'manual' && (
            <ManualDataIngestionWizard
              workspaceId={activeWorkspaceId}
              dataset={manualDataset}
              onDatasetChange={onManualDatasetChange}
              onNotify={onNotify}
              mode="load"
              loadTitle="Manual input"
              loadDescription="Upload a file or paste a raw CSV link."
            />
          )}

          {sourceType === 'sync' && (
            <div className="space-y-5 rounded-lg border border-[#509EE3]/20 bg-[#509EE3]/5 p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="block text-sm font-medium">Variables</Label>
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
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="remmaq-date-from" className="text-xs text-muted-foreground">
                    Date from
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
                    Date to
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
                  <Label className="text-xs text-muted-foreground">Reprocess</Label>
                  <button
                    type="button"
                    onClick={() => onRemmaqForceReprocessChange(!remmaqForceReprocess)}
                    className={`h-9 w-full rounded-md border px-3 text-xs font-medium transition-colors ${
                      remmaqForceReprocess
                        ? 'border-[#509EE3] bg-[#509EE3] text-white'
                        : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                    }`}
                  >
                    {remmaqForceReprocess ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <RefreshCw className="h-5 w-5 text-[#509EE3]" />
                    REMMAQ dataset
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Download, stage, map, then save.
                  </p>
                </div>
                <Button
                  size="default"
                  className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90"
                  onClick={() => void onSyncRemmaq()}
                  disabled={processingAction === 'sync'}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {processingAction === 'sync' ? 'Running...' : 'Run sync'}
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-white p-3">
                {processingAction === 'sync' ? (
                  <div className="flex items-start gap-3">
                    <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-[#509EE3]" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Running sync</p>
                      <p className="text-xs text-muted-foreground">
                        Loading REMMAQ data into the default ETL flow.
                      </p>
                    </div>
                  </div>
                ) : latestRun ? (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {selectedVariables.join(', ')} · {latestRun.status}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Inserted {latestRun.records_inserted.toLocaleString()} · Updated {latestRun.records_updated.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Ready</p>
                    <p className="text-xs text-muted-foreground">Choose variables and run a sync.</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <MetricCard label="Measurements" value={metrics ? metrics.total_measurements.toLocaleString() : '--'} hint="Stored" />
                <MetricCard label="Stations" value={metrics ? String(metrics.total_stations) : '--'} hint="Catalog" />
                <MetricCard label="Variables" value={metrics ? String(metrics.total_variables) : '--'} hint="Available" />
                <MetricCard label="Last status" value={metrics ? metrics.latest_run_status : '--'} hint="Run" />
              </div>

              {loading && <p className="text-xs text-muted-foreground">Loading status...</p>}
            </div>
          )}

          {sourceType === 'existing' && (
            <ExistingDataPanel
              filters={managerFilters}
              rows={managerRows}
              loading={managerLoading}
              querying={managerQuerying}
              exporting={managerExporting}
              error={managerError}
              selectedSourceFiles={managerSelectedSourceFiles}
              selectedStations={managerSelectedStations}
              selectedVariables={managerSelectedVariables}
              dateFrom={managerDateFrom}
              dateTo={managerDateTo}
              limit={managerLimit}
              maxLimit={managerMaxLimit}
              onDateFromChange={onManagerDateFromChange}
              onDateToChange={onManagerDateToChange}
              onLimitChange={onManagerLimitChange}
              onToggleSourceFile={onManagerToggleSourceFile}
              onToggleStation={onManagerToggleStation}
              onToggleVariable={onManagerToggleVariable}
              onRunQuery={onRunManagerQuery}
              onExportQuery={onExportManagerQuery}
              manualDatasets={manualDatasets}
              manualDatasetsLoading={manualDatasetsLoading}
              selectedExistingDatasetId={selectedExistingDatasetId}
              deletingDatasetId={deletingDatasetId}
              downloadingDatasetId={downloadingDatasetId}
              onSelectExistingDataset={onSelectExistingDataset}
              onDeleteDataset={onDeleteDataset}
              onDownloadDataset={onDownloadDataset}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MappingContent({
  sourceType,
  workspaceId,
  manualDataset,
  onManualDatasetChange,
  existingDataset,
  onExistingDatasetChange,
  previewRows,
  onNotify,
}: {
  sourceType: SourceMode;
  workspaceId: string | null;
  manualDataset: ManualDatasetResponse | null;
  onManualDatasetChange: (dataset: ManualDatasetResponse | null) => void;
  existingDataset: ManualDatasetResponse | null;
  onExistingDatasetChange: (dataset: ManualDatasetResponse | null) => void;
  previewRows: PreviewMeasurementRow[];
  onNotify: (message: StepMessage) => void;
}) {
  if (sourceType === 'manual') {
    return manualDataset ? (
      <ManualDataIngestionWizard
        workspaceId={workspaceId}
        dataset={manualDataset}
        onDatasetChange={onManualDatasetChange}
        onNotify={onNotify}
        mode="mapping"
      />
    ) : (
      <EmptyState title="No dataset loaded" description="Go back to Source and load a file first." />
    );
  }

  if (sourceType === 'sync') {
    return <EmptyState title="Mapping not required" description="REMMAQ syncs keep the default ETL flow." />;
  }

  if (sourceType === 'existing' && existingDataset) {
    return (
      <ManualDataIngestionWizard
        workspaceId={workspaceId}
        dataset={existingDataset}
        onDatasetChange={onExistingDatasetChange}
        onNotify={onNotify}
        mode="mapping"
      />
    );
  }

  return (
    <DatasetMappingStep
      previewRows={previewRows}
      title="Mapping"
      description="Review the current fields and preview the result."
      emptyMessage="Run a query or open a saved dataset first."
    />
  );
}

function SummaryContent({
  sourceType,
  manualDataset,
  existingDataset,
  runs,
  latestRun,
  loading,
  clearingRunHistory,
  onClearRunHistory,
  previewRows,
  existingRows,
}: {
  sourceType: SourceMode;
  manualDataset: ManualDatasetResponse | null;
  existingDataset: ManualDatasetResponse | null;
  runs: EtlRunResponse[];
  latestRun: EtlRunResponse | null;
  loading: boolean;
  clearingRunHistory: boolean;
  onClearRunHistory: () => Promise<void>;
  previewRows: EtlPreviewRowResponse[];
  existingRows: AnalyticsDataRow[];
}) {
  if (sourceType === 'manual') {
    return manualDataset ? (
      <ManualDatasetSummaryStep dataset={manualDataset} />
    ) : (
      <EmptyState title="No summary" description="Load and map a dataset first." />
    );
  }

  if (sourceType === 'sync') {
    return (
      <RunSummaryStep
        runs={runs}
        latestRun={latestRun}
        loading={loading}
        clearingRunHistory={clearingRunHistory}
        onClearRunHistory={onClearRunHistory}
        previewRows={previewRows}
      />
    );
  }

  if (sourceType === 'existing' && existingDataset) {
    return <ManualDatasetSummaryStep dataset={existingDataset} />;
  }

  if (sourceType === 'existing') {
    return <ExistingQuerySummary rows={existingRows} />;
  }

  return (
    <RunSummaryStep
      runs={runs}
      latestRun={latestRun}
      loading={loading}
      clearingRunHistory={clearingRunHistory}
      onClearRunHistory={onClearRunHistory}
      previewRows={previewRows}
    />
  );
}

function SourceCard({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: typeof Upload;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-all ${
        active ? 'border-[#509EE3] bg-[#509EE3]/5' : 'border-border hover:border-[#509EE3]/50'
      }`}
    >
      <div className="mb-3 inline-flex rounded-xl bg-[#509EE3]/10 p-2">
        <Icon className="h-6 w-6 text-[#509EE3]" />
      </div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

interface ExistingDataPanelProps {
  filters: AnalyticsFilterOptionsResponse | null;
  rows: AnalyticsDataRow[];
  loading: boolean;
  querying: boolean;
  exporting: boolean;
  error: string | null;
  selectedSourceFiles: number[];
  selectedStations: string[];
  selectedVariables: string[];
  dateFrom: string;
  dateTo: string;
  limit: number;
  maxLimit: number;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onToggleSourceFile: (sourceFileId: number) => void;
  onToggleStation: (stationCode: string) => void;
  onToggleVariable: (variableCode: string) => void;
  onRunQuery: () => Promise<void>;
  onExportQuery: () => Promise<void>;
  manualDatasets: ManualDatasetResponse[];
  manualDatasetsLoading: boolean;
  selectedExistingDatasetId: string | null;
  deletingDatasetId: string | null;
  downloadingDatasetId: string | null;
  onSelectExistingDataset: (datasetId: string) => void;
  onDeleteDataset: (datasetId: string) => Promise<void>;
  onDownloadDataset: (datasetId: string) => Promise<void>;
}

function ExistingDataPanel({
  filters,
  rows,
  loading,
  querying,
  exporting,
  error,
  selectedSourceFiles,
  selectedStations,
  selectedVariables,
  dateFrom,
  dateTo,
  limit,
  maxLimit,
  onDateFromChange,
  onDateToChange,
  onLimitChange,
  onToggleSourceFile,
  onToggleStation,
  onToggleVariable,
  onRunQuery,
  onExportQuery,
  manualDatasets,
  manualDatasetsLoading,
  selectedExistingDatasetId,
  deletingDatasetId,
  downloadingDatasetId,
  onSelectExistingDataset,
  onDeleteDataset,
  onDownloadDataset,
}: ExistingDataPanelProps) {
  const sourceCount = filters?.sources.length ?? 0;
  const selectedSavedDataset =
    manualDatasets.find((dataset) => dataset.id === selectedExistingDatasetId) ?? null;

  if (loading) {
    return (
      <div className="rounded-lg border bg-[#f8fbff] px-4 py-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-[#509EE3]" />
          Loading sources...
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="min-w-0 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">Files</Label>
            <Badge className="border border-[#509EE3]/25 bg-[#e9f3fd] text-[#1F5A8A] hover:bg-[#e9f3fd]">
              {sourceCount} available
            </Badge>
          </div>
          <div className="flex max-h-[180px] flex-wrap gap-2 overflow-auto rounded-md border bg-[#f8fbff] p-3">
            {(filters?.sources ?? []).map((source) => {
              const active = selectedSourceFiles.includes(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onToggleSourceFile(source.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    active
                      ? 'border-[#509EE3] bg-[#509EE3] text-white'
                      : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/70'
                  }`}
                  title={source.name}
                >
                  <div className="font-medium">{source.name}</div>
                  <div className="mt-1 opacity-80">{source.row_count.toLocaleString()} rows</div>
                </button>
              );
            })}
            {sourceCount === 0 && <span className="text-sm text-muted-foreground">No files available.</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="manager-date-from" className="text-xs text-muted-foreground">
              Date from
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
              Date to
            </Label>
            <Input
              id="manager-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => onDateToChange(event.target.value)}
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Variables</Label>
          <div className="flex max-h-[112px] flex-wrap gap-1.5 overflow-auto rounded-md border bg-[#f8fbff] p-2">
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
          <Label>Stations</Label>
          <div className="flex max-h-[112px] flex-wrap gap-1.5 overflow-auto rounded-md border bg-[#f8fbff] p-2">
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge className="border border-[#509EE3]/25 bg-[#e9f3fd] text-[#1F5A8A] hover:bg-[#e9f3fd]">
            {rows.length.toLocaleString()} rows in view
          </Badge>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-36 space-y-1">
              <Label htmlFor="manager-limit" className="text-xs text-muted-foreground">
                Preview limit
              </Label>
              <Input
                id="manager-limit"
                type="number"
                min={100}
                max={maxLimit}
                step={100}
                value={limit}
                onChange={(event) => onLimitChange(clampRowLimit(Number(event.target.value || 100), maxLimit))}
                className="h-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void onExportQuery()}
              disabled={exporting || selectedSourceFiles.length === 0}
              title={selectedSourceFiles.length === 0 ? 'Select one or more file cards first.' : undefined}
            >
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download CSV
            </Button>
            <Button className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90" onClick={() => void onRunQuery()} disabled={querying}>
              {querying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              Run query
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-[#1F5A8A]">{error}</p>}

        <div className="max-h-[360px] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b bg-[#f8fbff]">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Station</th>
                <th className="px-3 py-2 text-left">Variable</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">File</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Run a query or open a saved dataset.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={`${row.observed_at}-${row.station_code}-${row.variable_code}-${index}`} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formatEcuadorDateTime(row.observed_at)}</td>
                    <td className="px-3 py-2">{row.station_code}</td>
                    <td className="px-3 py-2">{row.variable_name || row.variable_code}</td>
                    <td className="px-3 py-2">{row.value}</td>
                    <td className="px-3 py-2">{row.unit ?? '-'}</td>
                    <td className="px-3 py-2 text-xs">{row.source_file_name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Saved datasets</CardTitle>
            <CardDescription>Datasets stored from manual ingestion.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {manualDatasetsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-[#509EE3]" />
                Loading datasets...
              </div>
            )}

            {!manualDatasetsLoading && manualDatasets.length === 0 && (
              <p className="text-sm text-muted-foreground">No saved datasets yet.</p>
            )}

            {manualDatasets.map((dataset) => (
              <div
                key={dataset.id}
                className={`w-full rounded-lg border p-4 transition-colors ${
                  selectedExistingDatasetId === dataset.id
                    ? 'border-[#509EE3] bg-[#509EE3]/5'
                    : 'border-border hover:border-[#509EE3]/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectExistingDataset(dataset.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{dataset.name}</p>
                      <p className="text-xs text-muted-foreground">{dataset.original_file_name}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={dataset.status} />
                    <button
                      type="button"
                      onClick={() => void onDownloadDataset(dataset.id)}
                      disabled={downloadingDatasetId === dataset.id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#509EE3]/30 text-[#1F5A8A] transition-colors hover:bg-[#e9f3fd] disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`Download ${dataset.name}`}
                      title={dataset.source_kind === 'remmaq' ? 'Download readable REMMAQ CSV' : 'Download dataset CSV'}
                    >
                      {downloadingDatasetId === dataset.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteDataset(dataset.id)}
                      disabled={deletingDatasetId === dataset.id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`Delete ${dataset.name}`}
                      title="Delete dataset"
                    >
                      {deletingDatasetId === dataset.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <button type="button" onClick={() => onSelectExistingDataset(dataset.id)} className="mt-3 w-full text-left">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{dataset.row_count.toLocaleString()} rows</span>
                    <span>{dataset.column_count} columns</span>
                    <span>{dataset.dataset_kind ?? 'dataset'}</span>
                  </div>
                </button>
              </div>
            ))}
          </CardContent>
        </Card>

        {selectedSavedDataset && (
          <Card className="min-w-0 bg-white">
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>{selectedSavedDataset.original_file_name}</CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Rows" value={selectedSavedDataset.row_count.toLocaleString()} hint="Stored" />
                <MetricCard label="Columns" value={String(selectedSavedDataset.column_count)} hint="Visible" />
              </div>
              <div className="min-w-0">
                <GenericPreviewTable
                  columns={selectedSavedDataset.columns.map((column) => column.name)}
                  rows={selectedSavedDataset.preview_rows}
                  emptyMessage="No preview available."
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

const getRunDetailString = (run: EtlRunResponse, key: string) => {
  const value = run.details[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const getRunVariables = (run: EtlRunResponse) => {
  const value = run.details.selected_variables;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const formatRunVariables = (run: EtlRunResponse) => {
  const variables = getRunVariables(run);
  return variables.length > 0 ? variables.join(', ') : '-';
};

const formatRunDateRange = (run: EtlRunResponse) => {
  const observedFrom = getRunDetailString(run, 'observed_from');
  const observedTo = getRunDetailString(run, 'observed_to');
  if (observedFrom && observedTo) return `${observedFrom} to ${observedTo}`;
  if (observedFrom) return `From ${observedFrom}`;
  if (observedTo) return `Until ${observedTo}`;
  return 'All available dates';
};

function RunSummaryStep({
  runs,
  latestRun,
  loading,
  clearingRunHistory,
  onClearRunHistory,
  previewRows,
}: {
  runs: EtlRunResponse[];
  latestRun: EtlRunResponse | null;
  loading: boolean;
  clearingRunHistory: boolean;
  onClearRunHistory: () => Promise<void>;
  previewRows: EtlPreviewRowResponse[];
}) {
  const latestRunVariables = latestRun ? formatRunVariables(latestRun) : '-';
  const latestRunDateRange = latestRun ? formatRunDateRange(latestRun) : '-';

  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Review user REMMAQ syncs and preview rows.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onClearRunHistory()}
              disabled={clearingRunHistory || loading || runs.length === 0}
              className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              {clearingRunHistory ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Clear history
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading runs...</p>}

          {!loading && latestRun && (
            <div className="mb-4 rounded-lg border border-border bg-[#F9FBFC] p-4">
              <div className="mb-2 flex items-center gap-2">
                {latestRun.status === 'completed' ? (
                  <Badge variant="outline" className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Latest run completed
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Latest run failed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Inserted: {latestRun.records_inserted} | Updated: {latestRun.records_updated} | Skipped:{' '}
                {latestRun.records_skipped}
              </p>
              <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
                <div>
                  <span className="font-medium text-foreground">Variables:</span> {latestRunVariables}
                </div>
                <div>
                  <span className="font-medium text-foreground">Date range:</span> {latestRunDateRange}
                </div>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-[#F9FBFC]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Run ID</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Started</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Variables</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date range</th>
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
                      <td className="px-4 py-3">{formatEcuadorDateTime(run.started_at)}</td>
                      <td className="max-w-[180px] px-4 py-3 text-xs">{formatRunVariables(run)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{formatRunDateRange(run)}</td>
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

          {runs.length === 0 && !loading && <p className="mt-4 text-sm text-muted-foreground">No runs yet.</p>}

          <div className="mt-6">
            <h4 className="mb-2 font-medium">Preview</h4>
            <MeasurementRowsTable rows={previewRows} emptyMessage="No rows available for preview." />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ExistingQuerySummary({ rows }: { rows: AnalyticsDataRow[] }) {
  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>Review the current query result.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard label="Rows" value={rows.length.toLocaleString()} hint="Current view" />
            <MetricCard label="Stations" value={String(new Set(rows.map((row) => row.station_code)).size)} hint="Visible" />
            <MetricCard label="Files" value={String(new Set(rows.map((row) => row.source_file_id)).size)} hint="Selected" />
          </div>
          <MeasurementRowsTable
            rows={rows.map((row) => ({
              observed_at: row.observed_at,
              station_code: row.station_code,
              variable_code: row.variable_code,
              value: row.value,
              unit: row.unit,
              source_file_name: row.source_file_name,
            }))}
            emptyMessage="Run a query first."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ManualDatasetSummaryStep({ dataset }: { dataset: ManualDatasetResponse }) {
  const mappingItems = [
    ['Datetime', dataset.mapping.datetime_column],
    ['Date', dataset.mapping.date_column],
    ['Time', dataset.mapping.time_column],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Summary</CardTitle>
              <CardDescription>{dataset.original_file_name}</CardDescription>
            </div>
            <StatusBadge status={dataset.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <MetricCard label="Rows" value={dataset.row_count.toLocaleString()} hint="Processed" />
            <MetricCard label="Columns" value={String(dataset.column_count)} hint="Visible" />
            <MetricCard label="Kind" value={dataset.dataset_kind ?? 'draft'} hint="Dataset" />
            <MetricCard label="Pipeline" value={String(dataset.operation_pipeline.length)} hint="Steps" />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Source</Label>
              <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {dataset.source_url ?? dataset.original_file_name}
              </div>
              <div className="flex flex-wrap gap-2">
                {dataset.operation_pipeline.length === 0 ? (
                  <Badge variant="outline">Base</Badge>
                ) : (
                  dataset.operation_pipeline.map((operation, index) => (
                    <Badge key={`${dataset.id}-op-${index}`} variant="outline">
                      {operation.type}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">Mapping</Label>
              <div className="rounded-lg border p-4">
                {mappingItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No role mapping defined.</p>
                ) : (
                  <div className="grid gap-2">
                    {mappingItems.map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Preview</Label>
            <GenericPreviewTable columns={dataset.columns.map((column) => column.name)} rows={dataset.preview_rows} emptyMessage="No rows available." />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DatasetMappingStep({
  previewRows,
  title,
  description,
  emptyMessage,
}: {
  previewRows: PreviewMeasurementRow[];
  title: string;
  description: string;
  emptyMessage: string;
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

  const csvHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(csvData)}`, [csvData]);
  const categoricalColumns = selectedColumns.filter((column) => !numericColumns.includes(column));

  return (
    <div className="space-y-6">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {allColumns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <>
              <div className="space-y-3">
                {[
                  { source: 'observed_at', target: 'date/time', type: 'datetime' },
                  { source: 'station_code', target: 'station', type: 'string' },
                  { source: 'variable_code', target: 'variable', type: 'string' },
                  { source: 'value', target: 'value', type: 'float' },
                  { source: 'unit', target: 'unit', type: 'string' },
                ].map((mapping) => (
                  <div key={mapping.source} className="flex items-center gap-4 rounded-lg bg-[#F9FBFC] p-4">
                    <div className="flex-1">
                      <Label className="mb-1 block text-xs text-muted-foreground">Field</Label>
                      <p className="font-medium">{mapping.source}</p>
                    </div>
                    <div className="text-muted-foreground">→</div>
                    <div className="flex-1">
                      <Label className="mb-1 block text-xs text-muted-foreground">Role</Label>
                      <p className="font-medium">{mapping.target}</p>
                    </div>
                    <div className="flex-1">
                      <Label className="mb-1 block text-xs text-muted-foreground">Type</Label>
                      <Badge variant="outline">{mapping.type}</Badge>
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-medium">Columns</Label>
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

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Numeric</Label>
                  <div className="flex min-h-16 flex-wrap gap-2 rounded-lg border bg-[#F9FBFC] p-3">
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
                  <Label className="text-sm font-medium">Categorical</Label>
                  <div className="flex min-h-16 flex-wrap gap-2 rounded-lg border bg-[#F9FBFC] p-3">
                    {categoricalColumns.length === 0 && <span className="text-xs text-muted-foreground">No columns selected.</span>}
                    {categoricalColumns.map((column) => (
                      <Badge key={`categorical-${column}`} variant="outline">
                        {column}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                    onChange={(event) => setSamplePct(Math.max(1, Math.min(100, Number(event.target.value || 100))))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="date-column" className="text-xs text-muted-foreground">
                    Date column
                  </Label>
                  <select
                    id="date-column"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={dateColumn}
                    onChange={(event) => setDateColumn(event.target.value)}
                  >
                    {selectedColumns.map((column) => (
                      <option key={`date-col-${column}`} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
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
                    {extractDateFeatures ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDropMissingRows((current) => !current)}
                  className={`h-10 rounded-md border text-xs font-medium transition-colors ${
                    dropMissingRows
                      ? 'border-[#509EE3] bg-[#509EE3] text-white'
                      : 'border-gray-300 bg-white text-foreground hover:border-[#509EE3]/60'
                  }`}
                >
                  {dropMissingRows ? 'Drop missing rows: on' : 'Drop missing rows: off'}
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
                  {imputeMissingValues ? 'Fill missing values: on' : 'Fill missing values: off'}
                </button>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Preview ({processedRows.length.toLocaleString()} rows)</Label>
                  <a href={csvHref} download="mapped_preview.csv">
                    <Button size="sm" className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90" disabled={!csvData}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Download CSV
                    </Button>
                  </a>
                </div>
                <GenericPreviewTable columns={previewColumns} rows={processedRows} emptyMessage={emptyMessage} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MeasurementRowsTable({
  rows,
  emptyMessage,
}: {
  rows: readonly PreviewMeasurementRow[];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="max-h-[320px] overflow-auto">
        <table className="min-w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[180px]" />
            <col className="w-[120px]" />
            <col className="w-[140px]" />
            <col className="w-[120px]" />
            <col className="w-[100px]" />
            <col className="w-[220px]" />
          </colgroup>
          <thead className="sticky top-0 border-b border-border bg-[#F9FBFC]">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Station</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Variable</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Value</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Unit</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">File</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={`${row.observed_at}-${row.station_code}-${row.variable_code}-${index}`} className="border-b border-border">
                  <td className="truncate whitespace-nowrap px-3 py-2" title={formatEcuadorDateTime(row.observed_at)}>
                    {formatEcuadorDateTime(row.observed_at)}
                  </td>
                  <td className="truncate px-3 py-2" title={row.station_code}>{row.station_code}</td>
                  <td className="truncate px-3 py-2" title={row.variable_code}>{row.variable_code}</td>
                  <td className="truncate px-3 py-2" title={String(row.value)}>{row.value}</td>
                  <td className="truncate px-3 py-2" title={row.unit ?? '-'}>{row.unit ?? '-'}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.source_file_name}>{row.source_file_name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsvDownloadFilename(label: string, fallback = 'dataset.csv') {
  const cleaned = label
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 140);
  const fallbackStem = fallback.replace(/\.[^.]+$/, '') || 'dataset';
  const stem = (cleaned || fallbackStem).replace(/\.[^.]+$/, '');
  return `${stem}.csv`;
}

function FloatingNotification({
  message,
  onClose,
}: {
  message: StepMessage;
  onClose: () => void;
}) {
  const isError = message.type === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div className="fixed right-5 top-5 z-50 w-[min(420px,calc(100vw-2.5rem))] rounded-lg border bg-white p-4 shadow-lg">
      <div className="flex gap-3">
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            isError ? 'text-red-600' : message.type === 'success' ? 'text-green-600' : 'text-[#509EE3]'
          }`}
        />
        <p className={`min-w-0 flex-1 text-sm ${isError ? 'text-red-700' : 'text-foreground'}`}>{message.text}</p>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
}

function GenericPreviewTable({
  columns,
  rows,
  emptyMessage,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  emptyMessage: string;
}) {
  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-border">
      <div className="max-h-[320px] overflow-auto">
        <table className="w-max min-w-full table-fixed text-sm">
          <thead className="sticky top-0 border-b border-border bg-[#F9FBFC]">
            <tr>
              {columns.map((column) => (
                <th key={column} className="min-w-[180px] max-w-[220px] px-3 py-2 text-left font-medium text-muted-foreground">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 || columns.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, columns.length)} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.slice(0, 120).map((row, index) => (
                <tr key={`row-${index}`} className="border-b border-border">
                  {columns.map((column) => (
                    <td key={`${index}-${column}`} className="px-3 py-2" title={stringifyCell(row[column])}>
                      <div className="max-w-[220px] truncate whitespace-nowrap">
                        {stringifyCell(row[column])}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized.startsWith('finalized')) {
    return (
      <Badge className="gap-1 border-green-200 bg-green-100 text-green-800 hover:bg-green-100">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Saved
      </Badge>
    );
  }

  if (normalized === 'draft') {
    return <Badge variant="outline">Draft</Badge>;
  }

  return (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3.5 w-3.5" />
      Error
    </Badge>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
