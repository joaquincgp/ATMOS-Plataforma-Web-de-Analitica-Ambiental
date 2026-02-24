import { useCallback, useEffect, useState } from 'react';

import {
  getEtlMetrics,
  getEtlRuns,
  initializeDatabase,
  syncRemmaq,
  type SyncRemmaqParams,
  uploadEtlFile,
  type DbInitResponse,
  type EtlMetricsResponse,
  type EtlRunResponse,
} from '@/api/modules/etl';

interface UseEtlState {
  runs: EtlRunResponse[];
  metrics: EtlMetricsResponse | null;
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
  const [metrics, setMetrics] = useState<EtlMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const [nextRuns, nextMetrics] = await Promise.all([getEtlRuns(20), getEtlMetrics()]);
      setRuns(nextRuns);
      setMetrics(nextMetrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown ETL error');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

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
      const response = await syncRemmaq(params);
      await refresh();
      return response;
    },
    [refresh],
  );

  const uploadManualFile = useCallback(
    async (file: File, forceReprocess = false) => {
      const response = await uploadEtlFile(file, forceReprocess);
      await refresh();
      return response;
    },
    [refresh],
  );

  return {
    runs,
    metrics,
    loading,
    refreshing,
    error,
    initDatabase,
    triggerRemmaqSync,
    uploadManualFile,
    refresh,
  };
}
