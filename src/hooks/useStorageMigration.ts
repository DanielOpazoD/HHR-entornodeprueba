/**
 * useStorageMigration Hook
 *
 * Handles migration from localStorage to IndexedDB on app startup.
 * Ensures data is preserved and backed up in IndexedDB.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { isIndexedDBAvailable } from '@/services/storage/indexeddb/indexedDbCore';
import { migrateFromLocalStorage } from '@/services/storage/indexeddb/indexedDbMigrationService';
import { storageMigrationLogger } from '@/hooks/hookLoggers';

interface MigrationState {
  isComplete: boolean;
  isMigrating: boolean;
  didMigrate: boolean;
  error: string | null;
}

interface UseStorageMigrationOptions {
  enabled?: boolean;
}

/**
 * Hook that runs storage migration on mount.
 * Returns migration status for UI feedback if needed.
 */
export const useStorageMigration = (options: UseStorageMigrationOptions = {}): MigrationState => {
  const { enabled = true } = options;
  const [state, setState] = useState<MigrationState>({
    isComplete: !enabled,
    isMigrating: enabled,
    didMigrate: false,
    error: null,
  });
  const pendingMigrationRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const runMigration = async () => {
      if (cancelled) {
        return;
      }

      setState({
        isComplete: false,
        isMigrating: true,
        didMigrate: false,
        error: null,
      });

      // Check if IndexedDB is available
      if (!isIndexedDBAvailable()) {
        storageMigrationLogger.warn('IndexedDB not available, using localStorage only');
        if (cancelled) {
          return;
        }
        setState({
          isComplete: true,
          isMigrating: false,
          didMigrate: false,
          error: null,
        });
        return;
      }

      let migration: Promise<boolean> | null = null;
      try {
        // Effect replay and re-enabling share an unfinished migration.
        migration = pendingMigrationRef.current ?? migrateFromLocalStorage();
        pendingMigrationRef.current = migration;
        const didMigrate = await migration;

        if (cancelled) {
          return;
        }

        setState({
          isComplete: true,
          isMigrating: false,
          didMigrate,
          error: null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        storageMigrationLogger.error('Storage migration failed', error);
        setState({
          isComplete: true,
          isMigrating: false,
          didMigrate: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        if (pendingMigrationRef.current === migration) pendingMigrationRef.current = null;
      }
    };

    void runMigration();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(
    () =>
      enabled
        ? state
        : {
            isComplete: true,
            isMigrating: false,
            didMigrate: false,
            error: null,
          },
    [enabled, state]
  );
};
