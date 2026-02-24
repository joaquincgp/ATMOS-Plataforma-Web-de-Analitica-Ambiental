import { useEffect, useState } from 'react';

import { getHealth, type HealthResponse } from '@/api/modules/health';

interface UseHealthCheckResult {
  health: HealthResponse | null;
  loading: boolean;
  error: string | null;
}

export function useHealthCheck(enabled = false): UseHealthCheckResult {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isMounted = true;

    async function runHealthCheck() {
      setLoading(true);
      setError(null);

      try {
        const response = await getHealth();
        if (isMounted) {
          setHealth(response);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void runHealthCheck();

    return () => {
      isMounted = false;
    };
  }, [enabled]);

  return { health, loading, error };
}
