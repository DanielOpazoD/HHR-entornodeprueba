import { useEffect, useState } from 'react';
import { isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import {
  hasE2ERuntimeOverride,
  shouldExposeDatabaseFallbackToUi,
} from '@/services/storage/indexeddb/indexedDbRuntimeModeController';

export const DATABASE_FALLBACK_POLL_INTERVAL_MS = 5000;

interface UseDatabaseFallbackStatusOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
}

const readDatabaseFallbackUiStatus = (): boolean =>
  shouldExposeDatabaseFallbackToUi({
    fallbackMode: isDatabaseInFallbackMode(),
    e2eOverrideActive: hasE2ERuntimeOverride(),
  });

/**
 * Shared polling hook for IndexedDB fallback state.
 * Keeps UI components aligned without duplicating interval logic.
 */
export const useDatabaseFallbackStatus = (
  options: UseDatabaseFallbackStatusOptions = {}
): boolean => {
  const { enabled = true, pollIntervalMs = DATABASE_FALLBACK_POLL_INTERVAL_MS } = options;
  const [isFallback, setIsFallback] = useState(readDatabaseFallbackUiStatus);

  useEffect(() => {
    if (!enabled) return;

    const syncStatus = () => {
      setIsFallback(readDatabaseFallbackUiStatus());
    };

    const isDocumentHidden = () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden';

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (intervalId || isDocumentHidden()) return;
      intervalId = setInterval(syncStatus, pollIntervalMs);
    };

    const stopPolling = () => {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const handleVisibilityChange = () => {
      syncStatus();
      if (isDocumentHidden()) {
        stopPolling();
        return;
      }

      startPolling();
    };

    syncStatus();
    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, pollIntervalMs]);

  return isFallback;
};
