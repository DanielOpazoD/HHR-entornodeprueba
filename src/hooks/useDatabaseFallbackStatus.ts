import { useEffect, useState } from 'react';
import { isDatabaseInFallbackMode } from '@/services/storage/indexedDBService';

export const DATABASE_FALLBACK_POLL_INTERVAL_MS = 5000;

interface UseDatabaseFallbackStatusOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
}

/**
 * Shared polling hook for IndexedDB fallback state.
 * Keeps UI components aligned without duplicating interval logic.
 */
export const useDatabaseFallbackStatus = (
  options: UseDatabaseFallbackStatusOptions = {}
): boolean => {
  const { enabled = true, pollIntervalMs = DATABASE_FALLBACK_POLL_INTERVAL_MS } = options;
  const [isFallback, setIsFallback] = useState(() => isDatabaseInFallbackMode());

  useEffect(() => {
    if (!enabled) return;

    const syncStatus = () => {
      setIsFallback(isDatabaseInFallbackMode());
    };

    syncStatus();
    const intervalId = setInterval(syncStatus, pollIntervalMs);

    return () => clearInterval(intervalId);
  }, [enabled, pollIntervalMs]);

  return isFallback;
};
