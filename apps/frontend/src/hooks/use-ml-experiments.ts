import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearMLExperimentRunHistory,
  deleteMLExperimentRun,
  deleteMLExperimentSource,
  getMLExperimentRun,
  getMLExperimentSource,
  listMLExperimentRuns,
  listMLExperimentSources,
  submitMLExperimentRun,
  syncMLExperimentSource,
  type MLExperimentRunDetail,
  type MLExperimentRunRequest,
  type MLExperimentRunSummary,
  type MLExperimentSource,
  type MLExperimentSourceSyncRequest,
} from '@/api/modules/ml-experiments';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 400; // ~10 minutes, generous for up to 100 CPU-trained epochs.
const SOURCE_POLL_INTERVAL_MS = 2000;
// A full-history REMMAQ sync (4 archives, no date filter) has been observed
// taking 15-20+ minutes end to end. 900 attempts * 2s = 30 minutes, with
// real margin above that observed worst case.
const MAX_SOURCE_POLL_ATTEMPTS = 900;

interface UseMLExperimentsState {
  currentRun: MLExperimentRunDetail | null;
  runs: MLExperimentRunSummary[];
  isTraining: boolean;
  error: string | null;
  sources: MLExperimentSource[];
  sourcesLoading: boolean;
  sourceError: string | null;
  syncingSourceId: string | null;
}

interface UseMLExperimentsActions {
  submitRun: (payload: MLExperimentRunRequest) => Promise<MLExperimentRunDetail | null>;
  loadRun: (runId: string) => Promise<void>;
  refreshHistory: () => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  refreshSources: () => Promise<void>;
  refreshSource: (sourceId: string) => Promise<void>;
  syncSource: (payload: MLExperimentSourceSyncRequest) => Promise<void>;
  deleteSource: (sourceId: string) => Promise<void>;
}

export function useMLExperiments(workspaceId: string | null): UseMLExperimentsState & UseMLExperimentsActions {
  const [currentRun, setCurrentRun] = useState<MLExperimentRunDetail | null>(null);
  const [runs, setRuns] = useState<MLExperimentRunSummary[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<MLExperimentSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const sourcePollAbortRef = useRef(false);
  // Tracks source IDs with an active poll loop, regardless of whether it was
  // started by syncSource() (user just clicked "Sincronizar") or resumed by
  // refreshSources() (page load/reload found one already mid-sync). Prevents
  // two redundant poll loops for the same source, and is what lets a sync
  // still in progress keep updating live after a reload.
  const polledSourceIdsRef = useRef<Set<string>>(new Set());

  const refreshHistory = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    try {
      const history = await listMLExperimentRuns(workspaceId);
      setRuns(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial de experimentos.');
    }
  }, [workspaceId]);

  useEffect(() => {
    sourcePollAbortRef.current = false;
    return () => {
      sourcePollAbortRef.current = true;
    };
  }, [workspaceId]);

  const pollRun = useCallback(async (runId: string): Promise<MLExperimentRunDetail | null> => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const run = await getMLExperimentRun(runId);
      setCurrentRun(run);
      if (run.status !== 'pending' && run.status !== 'running') {
        return run;
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
    return null;
  }, []);

  const submitRun = useCallback(
    async (payload: MLExperimentRunRequest) => {
      setError(null);
      setIsTraining(true);
      try {
        const created = await submitMLExperimentRun(payload);
        setCurrentRun(created);
        const finished = await pollRun(created.id);
        await refreshHistory();
        if (finished?.status === 'failed') {
          setError(finished.error_message ?? 'El entrenamiento falló inesperadamente.');
        }
        return finished ?? created;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo iniciar el entrenamiento.');
        return null;
      } finally {
        setIsTraining(false);
      }
    },
    [pollRun, refreshHistory],
  );

  const loadRun = useCallback(async (runId: string) => {
    setError(null);
    try {
      const run = await getMLExperimentRun(runId);
      setCurrentRun(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el experimento.');
    }
  }, []);

  const deleteRun = useCallback(
    async (runId: string) => {
      setError(null);
      try {
        await deleteMLExperimentRun(runId);
        setCurrentRun((previous) => (previous?.id === runId ? null : previous));
        await refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo eliminar el experimento.');
      }
    },
    [refreshHistory],
  );

  const clearHistory = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    setError(null);
    try {
      await clearMLExperimentRunHistory(workspaceId);
      setCurrentRun(null);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo limpiar el historial de experimentos.');
    }
  }, [workspaceId, refreshHistory]);

  const pollSource = useCallback(async (sourceId: string): Promise<void> => {
    if (polledSourceIdsRef.current.has(sourceId)) {
      return; // Already tracked by another poll loop (e.g. syncSource's own call).
    }
    polledSourceIdsRef.current.add(sourceId);
    try {
      for (let attempt = 0; attempt < MAX_SOURCE_POLL_ATTEMPTS; attempt += 1) {
        if (sourcePollAbortRef.current) {
          return;
        }
        const source = await getMLExperimentSource(sourceId);
        setSources((previous) => {
          const exists = previous.some((item) => item.id === source.id);
          return exists ? previous.map((item) => (item.id === source.id ? source : item)) : [source, ...previous];
        });
        if (source.status !== 'syncing') {
          if (source.status === 'failed') {
            setSourceError(source.error_message ?? 'No se pudo sincronizar la fuente REMMAQ.');
          }
          return;
        }
        await new Promise((resolve) => {
          window.setTimeout(resolve, SOURCE_POLL_INTERVAL_MS);
        });
      }
      // Loop exhausted MAX_SOURCE_POLL_ATTEMPTS without resolving: rather than
      // silently going quiet and leaving a stale progress indicator on screen,
      // say so explicitly. Reloading the page will resume tracking again.
      if (!sourcePollAbortRef.current) {
        setSourceError(
          'La sincronización está tardando más de lo esperado. Recargá la página para seguir el avance.',
        );
      }
    } finally {
      polledSourceIdsRef.current.delete(sourceId);
    }
  }, []);

  const refreshSources = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    setSourcesLoading(true);
    try {
      const list = await listMLExperimentSources(workspaceId);
      setSources(list);
      // Resume live tracking for any source still mid-sync, regardless of
      // whether this page load/reload is what started it — this is what lets
      // progress keep updating automatically without a manual refresh.
      for (const source of list) {
        if (source.status === 'syncing') {
          void pollSource(source.id);
        }
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'No se pudieron cargar las fuentes de ML Experiments.');
    } finally {
      setSourcesLoading(false);
    }
  }, [workspaceId, pollSource]);

  // On-demand "check now" for a single source, e.g. a manual refresh icon
  // next to a syncing source — independent of the automatic poll loop above,
  // so the user can confirm the latest state immediately without waiting for
  // the next tick or leaving the page.
  const refreshSource = useCallback(async (sourceId: string) => {
    setSourceError(null);
    try {
      const source = await getMLExperimentSource(sourceId);
      setSources((previous) => {
        const exists = previous.some((item) => item.id === source.id);
        return exists ? previous.map((item) => (item.id === source.id ? source : item)) : [source, ...previous];
      });
      if (source.status === 'failed') {
        setSourceError(source.error_message ?? 'No se pudo sincronizar la fuente REMMAQ.');
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'No se pudo actualizar el estado de la fuente.');
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
    void refreshSources();
  }, [refreshHistory, refreshSources]);

  const syncSource = useCallback(
    async (payload: MLExperimentSourceSyncRequest) => {
      setSourceError(null);
      try {
        const draft = await syncMLExperimentSource(payload);
        setSources((previous) => [draft, ...previous]);
        setSyncingSourceId(draft.id);
        await pollSource(draft.id);
      } catch (err) {
        setSourceError(err instanceof Error ? err.message : 'No se pudo iniciar la sincronización de la fuente.');
      } finally {
        setSyncingSourceId(null);
      }
    },
    [pollSource],
  );

  const deleteSource = useCallback(async (sourceId: string) => {
    setSourceError(null);
    try {
      await deleteMLExperimentSource(sourceId);
      setSources((previous) => previous.filter((item) => item.id !== sourceId));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'No se pudo eliminar la fuente.');
    }
  }, []);

  return {
    currentRun,
    runs,
    isTraining,
    error,
    sources,
    sourcesLoading,
    sourceError,
    syncingSourceId,
    submitRun,
    loadRun,
    refreshHistory,
    deleteRun,
    clearHistory,
    refreshSources,
    refreshSource,
    syncSource,
    deleteSource,
  };
}
