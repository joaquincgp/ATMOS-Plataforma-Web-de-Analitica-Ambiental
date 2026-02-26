import { useCallback, useEffect, useState } from 'react';

import {
  getEtlRun,
  getEtlMetrics,
  getEtlPreview,
  getEtlRuns,
  initializeDatabase,
  startSyncRemmaq,
  startUploadEtlFile,
  type SyncRemmaqParams,
  type DbInitResponse,
  type EtlMetricsResponse,
  type EtlPreviewRowResponse,
  type EtlRunResponse,
} from '@/api/modules/etl';

interface UseEtlState {
  runs: EtlRunResponse[];
  currentRun: EtlRunResponse | null;
  metrics: EtlMetricsResponse | null;
  previewRows: EtlPreviewRowResponse[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
}

interface UseEtlActions {
  initDatabase: () => Promise<DbInitResponse>;
  triggerRemmaqSync: (params?: SyncRemmaqParams) => Promise<EtlRunResponse>;
  uploadManualFile: (file: File, forceReprocess?: boolean) => Promise<EtlRunResponse>;
  refresh: () => Promise<void>;
}

export function useEtl(): UseEtlState & UseEtlActions {
  const [runs, setRuns] = useState<EtlRunResponse[]>([]);
  const [currentRun, setCurrentRun] = useState<EtlRunResponse | null>(null);
  const [metrics, setMetrics] = useState<EtlMetricsResponse | null>(null);
  const [previewRows, setPreviewRows] = useState<EtlPreviewRowResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsertRun = useCallback((run: EtlRunResponse) => {
    setRuns((previous) => {
      const next = [run, ...previous.filter((item) => item.id !== run.id)];
      next.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      return next;
    });
    setCurrentRun(run);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const [nextRuns, nextMetrics] = await Promise.all([getEtlRuns(20), getEtlMetrics()]);
      setRuns(nextRuns);
      setCurrentRun(nextRuns[0] ?? null);
      setMetrics(nextMetrics);
      const preview = await getEtlPreview(nextRuns[0]?.id, 80);
      setPreviewRows(preview.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown ETL error');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  const pollRun = useCallback(
    async (runId: string) => {
      let lastRun: EtlRunResponse | null = null;

      for (let attempt = 0; attempt < 600; attempt += 1) {
        const run = await getEtlRun(runId);
        upsertRun(run);
        lastRun = run;

        if (run.status !== 'running') {
          break;
        }

        if (attempt % 4 === 0) {
          const nextMetrics = await getEtlMetrics();
          setMetrics(nextMetrics);
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 1200);
        });
      }

      await refresh();
      return lastRun;
    },
    [refresh, upsertRun],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const initDatabase = useCallback(async () => {
    const response = await initializeDatabase();
    await refresh();
    return response;
  }, [refresh]);

  const triggerRemmaqSync = useCallback(
    async (params: SyncRemmaqParams = {}) => {
      const run = await startSyncRemmaq(params);
      upsertRun(run);
      const lastRun = await pollRun(run.id);
      return lastRun ?? run;
    },
    [pollRun, upsertRun],
  );

  const uploadManualFile = useCallback(
    async (file: File, forceReprocess = false) => {
      const run = await startUploadEtlFile(file, forceReprocess);
      upsertRun(run);
      const lastRun = await pollRun(run.id);
      return lastRun ?? run;
    },
    [pollRun, upsertRun],
  );

  return {
    runs,
    currentRun,
    metrics,
    previewRows,
    loading,
    refreshing,
    error,
    initDatabase,
    triggerRemmaqSync,
    uploadManualFile,
    refresh,
  };
}
