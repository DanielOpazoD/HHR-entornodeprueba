/**
 * useStorageMigration Hook
 * 
 * Handles migration from localStorage to IndexedDB on app startup.
 * Ensures data is preserved and backed up in IndexedDB.
 */

import { useState, useEffect } from 'react';
import {
    migrateFromLocalStorage,
    isIndexedDBAvailable
} from '@/services/storage/indexedDBService';

interface MigrationState {
    isComplete: boolean;
    isMigrating: boolean;
    didMigrate: boolean;
    error: string | null;
}

/**
 * Hook that runs storage migration on mount.
 * Returns migration status for UI feedback if needed.
 */
export const useStorageMigration = (): MigrationState => {
    const [state, setState] = useState<MigrationState>({
        isComplete: false,
        isMigrating: true,
        didMigrate: false,
        error: null
    });

    useEffect(() => {
        const runMigration = async () => {
            // Check if IndexedDB is available
            if (!isIndexedDBAvailable()) {
                console.warn('⚠️ IndexedDB not available, using localStorage only');
                setState({
                    isComplete: true,
                    isMigrating: false,
                    didMigrate: false,
                    error: null
                });
                return;
            }

            try {
                // Run migration (will skip if already done)
                const didMigrate = await migrateFromLocalStorage();

                setState({
                    isComplete: true,
                    isMigrating: false,
                    didMigrate,
                    error: null
                });
            } catch (error) {
                console.error('❌ Storage migration error:', error);
                setState({
                    isComplete: true,
                    isMigrating: false,
                    didMigrate: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        };

        runMigration();
    }, []);

    return state;
};
