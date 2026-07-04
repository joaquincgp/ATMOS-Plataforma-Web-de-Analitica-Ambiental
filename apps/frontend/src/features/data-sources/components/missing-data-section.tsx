import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, Loader2, Rows3, WandSparkles } from 'lucide-react';

import {
  applyManualDatasetMissingDataAction,
  getManualDatasetMissingDataOverview,
  listManualDatasets,
  type ManualDatasetMissingDataAction,
  type ManualDatasetMissingDataOverviewResponse,
  type ManualDatasetResponse,
} from '@/api/modules/etl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWorkspace } from '@/contexts/workspace-context';
import { formatEcuadorDateTime, parseBackendDateInEcuador } from '@/shared/lib/datetime';

interface FloatingNotice {
  type: 'success' | 'error' | 'info';
  text: string;
}

export function MissingDataSection() {
  const { activeWorkspaceId } = useWorkspace();
  const [datasets, setDatasets] = useState<ManualDatasetResponse[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [overview, setOverview] = useState<ManualDatasetMissingDataOverviewResponse | null>(null);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [processingAction, setProcessingAction] = useState<ManualDatasetMissingDataAction | null>(null);
  const [notice, setNotice] = useState<FloatingNotice | null>(null);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  );

  const finalizedDatasets = useMemo(
    () => datasets.filter((dataset) => dataset.status.startsWith('finalized')),
    [datasets],
  );

  const showNotice = useCallback((nextNotice: FloatingNotice) => {
    setNotice(nextNotice);
    window.setTimeout(() => {
      setNotice((current) => (current?.text === nextNotice.text ? null : current));
    }, 4500);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setDatasets([]);
      setSelectedDatasetId('');
      setOverview(null);
      return;
    }

    let cancelled = false;

    const loadDatasets = async () => {
      setLoadingDatasets(true);
      try {
        const nextDatasets = await listManualDatasets(activeWorkspaceId);
        if (cancelled) {
          return;
        }
        const nextFinalized = nextDatasets.filter((dataset) => dataset.status.startsWith('finalized'));
        setDatasets(nextDatasets);
        setSelectedDatasetId((current) => {
          if (current && nextFinalized.some((dataset) => dataset.id === current)) {
            return current;
          }
          return nextFinalized[0]?.id ?? '';
        });
      } catch (error) {
        if (!cancelled) {
          showNotice({
            type: 'error',
            text: error instanceof Error ? error.message : 'Could not load datasets.',
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingDatasets(false);
        }
      }
    };

    void loadDatasets();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, showNotice]);

  const loadOverview = useCallback(
    async (datasetId: string) => {
      if (!datasetId) {
        setOverview(null);
        return;
      }
      setLoadingOverview(true);
      try {
        const nextOverview = await getManualDatasetMissingDataOverview(datasetId);
        setOverview(nextOverview);
      } catch (error) {
        setOverview(null);
        showNotice({
          type: 'error',
          text: error instanceof Error ? error.message : 'Could not load missing data overview.',
        });
      } finally {
        setLoadingOverview(false);
      }
    },
    [showNotice],
  );

  useEffect(() => {
    void loadOverview(selectedDatasetId);
  }, [loadOverview, selectedDatasetId]);

  const applyAction = async (action: ManualDatasetMissingDataAction) => {
    if (!selectedDataset) {
      showNotice({ type: 'info', text: 'Choose a dataset first.' });
      return;
    }
    if (!overview || overview.total_missing_values === 0) {
      showNotice({ type: 'info', text: 'This dataset has no missing values.' });
      return;
    }

    setProcessingAction(action);
    try {
      const derivedDataset = await applyManualDatasetMissingDataAction(selectedDataset.id, { action });
      const nextDatasets = [derivedDataset, ...datasets.filter((dataset) => dataset.id !== derivedDataset.id)].sort(
        (left, right) =>
          parseBackendDateInEcuador(right.updated_at).getTime() - parseBackendDateInEcuador(left.updated_at).getTime(),
      );
      setDatasets(nextDatasets);
      setSelectedDatasetId(derivedDataset.id);
      showNotice({
        type: 'success',
        text:
          action === 'remove_rows'
            ? `Rows with missing values removed. Created "${derivedDataset.name}".`
            : `Missing values imputed. Created "${derivedDataset.name}".`,
      });
    } catch (error) {
      showNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not create the cleaned dataset.',
      });
    } finally {
      setProcessingAction(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FBFC]">
      {notice && <FloatingNotification notice={notice} onClose={() => setNotice(null)} />}

      <div className="px-6 py-5">
        <div className="mb-5">
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Missing Data</h1>
          <p className="text-muted-foreground">Inspect null values and persist cleaning results as derived datasets.</p>
        </div>

        <div className="mx-auto max-w-7xl space-y-5">
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-[#509EE3]" />
                Dataset
              </CardTitle>
              <CardDescription>Manual uploads and REMMAQ datasets are supported.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="missing-data-dataset">Source dataset</Label>
                <Select value={selectedDatasetId} onValueChange={setSelectedDatasetId} disabled={loadingDatasets}>
                  <SelectTrigger id="missing-data-dataset" className="bg-white">
                    <SelectValue placeholder={loadingDatasets ? 'Loading datasets...' : 'Choose a dataset'} />
                  </SelectTrigger>
                  <SelectContent>
                    {finalizedDatasets.map((dataset) => (
                      <SelectItem key={dataset.id} value={dataset.id}>
                        {dataset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={() => void loadOverview(selectedDatasetId)} disabled={loadingOverview}>
                {loadingOverview && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh
              </Button>
            </CardContent>
          </Card>

          {selectedDataset && (
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Dataset type" value={selectedDataset.source_kind.toUpperCase()} />
              <Metric label="Rows" value={selectedDataset.row_count.toLocaleString()} />
              <Metric label="Columns" value={selectedDataset.column_count.toLocaleString()} />
              <Metric label="Updated" value={formatEcuadorDateTime(selectedDataset.updated_at)} />
            </div>
          )}

          <Card className="bg-white">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Missing Data Overview</CardTitle>
                  <CardDescription>Missing values by column.</CardDescription>
                </div>
                {overview && (
                  <Badge variant={overview.total_missing_values === 0 ? 'outline' : 'secondary'}>
                    {overview.total_missing_values.toLocaleString()} missing values
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[420px] overflow-auto rounded-md border">
                <Table className="w-full min-w-[760px] table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[30%]" />
                      <TableHead className="w-[30%]">Column</TableHead>
                      <TableHead className="w-[20%] text-right">Missing Values</TableHead>
                      <TableHead className="w-[20%] text-right">Percentage Missing (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingOverview ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                          Loading overview...
                        </TableCell>
                      </TableRow>
                    ) : overview?.columns.length ? (
                      overview.columns.map((column) => (
                        <TableRow key={column.column}>
                          <TableCell className="font-medium text-muted-foreground" title={column.column}>
                            <div className="truncate">{column.column}</div>
                          </TableCell>
                          <TableCell className="font-medium" title={column.column}>
                            <div className="truncate">{column.column}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {column.missing_values.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {column.percentage_missing.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                          Select a saved dataset to inspect missing values.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="text-xl">Data Cleaning Options</CardTitle>
              <CardDescription>Each action creates a new derived dataset. The original file is never overwritten.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => void applyAction('remove_rows')}
                disabled={processingAction !== null || !overview || overview.total_missing_values === 0}
              >
                {processingAction === 'remove_rows' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rows3 className="mr-2 h-4 w-4" />
                )}
                Remove Rows with Any Missing Values
              </Button>
              <Button
                onClick={() => void applyAction('impute_knn_mode')}
                disabled={processingAction !== null || !overview || overview.total_missing_values === 0}
                className="bg-[#509EE3] text-white hover:bg-[#509EE3]/90"
              >
                {processingAction === 'impute_knn_mode' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <WandSparkles className="mr-2 h-4 w-4" />
                )}
                Impute with KNN and Mode
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FloatingNotification({
  notice,
  onClose,
}: {
  notice: FloatingNotice;
  onClose: () => void;
}) {
  const isError = notice.type === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div className="fixed right-5 top-5 z-50 w-[min(420px,calc(100vw-2.5rem))] rounded-lg border bg-white p-4 shadow-lg">
      <div className="flex gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isError ? 'text-red-600' : 'text-green-600'}`} />
        <p className={`min-w-0 flex-1 text-sm ${isError ? 'text-red-700' : 'text-foreground'}`}>{notice.text}</p>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}
