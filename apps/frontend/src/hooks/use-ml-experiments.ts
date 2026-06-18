import { useCallback, useEffect, useState } from 'react';

import {
  getMLExperimentRun,
  listMLExperimentRuns,
  submitMLExperimentRun,
  type MLExperimentRunDetail,
  type MLExperimentRunRequest,
  type MLExperimentRunSummary,
} from '@/api/modules/ml-experiments';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 400; // ~10 minutes, generous for up to 100 CPU-trained epochs.

interface UseMLExperimentsState {
  currentRun: MLExperimentRunDetail | null;
  runs: MLExperimentRunSummary[];
  isTraining: boolean;
  error: string | null;
}

interface UseMLExperimentsActions {
  submitRun: (payload: MLExperimentRunRequest) => Promise<MLExperimentRunDetail | null>;
  loadRun: (runId: string) => Promise<void>;
  refreshHistory: () => Promise<void>;
}

export function useMLExperiments(workspaceId: string | null): UseMLExperimentsState & UseMLExperimentsActions {
  const [currentRun, setCurrentRun] = useState<MLExperimentRunDetail | null>(null);
  const [runs, setRuns] = useState<MLExperimentRunSummary[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    void refreshHistory();
  }, [refreshHistory]);

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

  return {
    currentRun,
    runs,
    isTraining,
    error,
    submitRun,
    loadRun,
    refreshHistory,
  };
}
