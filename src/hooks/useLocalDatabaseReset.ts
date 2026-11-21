import { useCallback } from 'react';
import { resetLocalDatabase } from '@/services/storage/indexeddb/indexedDbMaintenanceService';

/**
 * Exposes the local IndexedDB reset action behind a hook boundary so shared UI
 * components stay decoupled from storage maintenance services.
 */
export const useLocalDatabaseReset = (): (() => Promise<void>) =>
  useCallback(() => resetLocalDatabase(), []);
