import { useEffect } from 'react';
import { createCensusStorageRuntime } from '@/features/census/controllers/censusBrowserRuntimeAdapter';
import { executeCensusMigrationBootstrapController } from '@/features/census/controllers/censusMigrationBootstrapController';
import { censusMigrationLogger } from '@/features/census/hooks/censusHookLoggers';

export const useCensusMigrationBootstrap = (): void => {
  useEffect(() => {
    let cancelled = false;
    const runBootstrap = () => {
      if (cancelled) {
        return;
      }

      const result = executeCensusMigrationBootstrapController(createCensusStorageRuntime());

      if (!result.ok) {
        censusMigrationLogger.warn('Migration bootstrap failed', result.error.message);
      }
    };

    const idleCallback =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(runBootstrap, { timeout: 1200 })
        : window.setTimeout(runBootstrap, 0);

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallback as number);
        return;
      }
      window.clearTimeout(idleCallback);
    };
  }, []);
};
