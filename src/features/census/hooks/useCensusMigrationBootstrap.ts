import { useEffect, useMemo } from 'react';
import {
  createCensusMigrationStorageRuntime,
  executeCensusMigrationBootstrapController,
} from '@/features/census/controllers/censusMigrationBootstrapController';

export const useCensusMigrationBootstrap = (): void => {
  const migrationStorage = useMemo(() => createCensusMigrationStorageRuntime(), []);

  useEffect(() => {
    const result = executeCensusMigrationBootstrapController(migrationStorage);

    if (!result.ok) {
      console.error('[Migration] Failed:', result.error.message);
    }
  }, [migrationStorage]);
};
