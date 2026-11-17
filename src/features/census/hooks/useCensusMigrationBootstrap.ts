import { useEffect, useMemo } from 'react';
import {
  createCensusMigrationStorageRuntime,
  executeCensusMigrationBootstrapController,
} from '@/features/census/controllers/censusMigrationBootstrapController';
import { censusMigrationLogger } from '@/features/census/hooks/censusHookLoggers';

export const useCensusMigrationBootstrap = (enabled = true): void => {
  const migrationStorage = useMemo(() => createCensusMigrationStorageRuntime(), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    const runBootstrap = () => {
      if (cancelled) {
        return;
      }

      const result = executeCensusMigrationBootstrapController(migrationStorage);

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
  }, [enabled, migrationStorage]);
};
