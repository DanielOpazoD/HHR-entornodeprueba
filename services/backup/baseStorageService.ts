/**
 * Base Storage Service
 * Shared utilities and factory functions for Firebase Storage services
 * 
 * This module provides:
 * - Common constants (MONTH_NAMES)
 * - Generic factory functions for listing years, months, and files
 * - Shared types for stored files
 */

import {
    ref,
    listAll,
    getDownloadURL,
    getMetadata,
    StorageReference
} from 'firebase/storage';
import { storage, firebaseReady } from '../../firebaseConfig';

// ============= Types =============

export interface MonthInfo {
    number: string;
    name: string;
}

export interface BaseStoredFile {
    name: string;
    fullPath: string;
    downloadUrl: string;
    date: string;
    createdAt: string;
    size: number;
}

export interface ListFilesConfig<T> {
    storageRoot: string;
    parseFilePath: (path: string) => { date: string;[key: string]: any } | null;
    mapToFile: (item: StorageReference, metadata: any, downloadUrl: string, parsed: any) => T;
}

// ============= Constants =============

export const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ============= Default Timeouts =============

const DEFAULT_LIST_TIMEOUT_MS = 5000;
const DEFAULT_FILES_TIMEOUT_MS = 15000;

// ============= Factory Functions =============

/**
 * Creates a function to list all years in a storage root
 */
export const createListYears = (storageRoot: string) => {
    return async (): Promise<string[]> => {
        try {
            await firebaseReady;
            if (!storage) return [];

            const timeoutPromise = new Promise<string[]>((resolve) =>
                setTimeout(() => resolve([]), DEFAULT_LIST_TIMEOUT_MS)
            );

            const listPromise = (async () => {
                const rootRef = ref(storage, storageRoot);
                const result = await listAll(rootRef);
                return result.prefixes.map(p => p.name).sort((a, b) => b.localeCompare(a));
            })();

            return await Promise.race([listPromise, timeoutPromise]);
        } catch (error) {
            console.warn(`[BaseStorage] Error listing years for ${storageRoot}:`, error);
            return [];
        }
    };
};

/**
 * Creates a function to list all months in a year
 */
export const createListMonths = (storageRoot: string) => {
    return async (year: string): Promise<MonthInfo[]> => {
        try {
            await firebaseReady;
            if (!storage) return [];

            const timeoutPromise = new Promise<MonthInfo[]>((resolve) =>
                setTimeout(() => resolve([]), DEFAULT_LIST_TIMEOUT_MS)
            );

            const listPromise = (async () => {
                const yearRef = ref(storage, `${storageRoot}/${year}`);
                const result = await listAll(yearRef);
                return result.prefixes
                    .map(p => ({
                        number: p.name,
                        name: MONTH_NAMES[parseInt(p.name) - 1] || p.name
                    }))
                    .sort((a, b) => b.number.localeCompare(a.number));
            })();

            return await Promise.race([listPromise, timeoutPromise]);
        } catch (error) {
            console.warn(`[BaseStorage] Error listing months for ${storageRoot}/${year}:`, error);
            return [];
        }
    };
};

/**
 * Creates a function to list all files in a month
 */
export const createListFilesInMonth = <T extends BaseStoredFile>(config: ListFilesConfig<T>) => {
    return async (year: string, month: string): Promise<T[]> => {
        const fullStoragePath = `${config.storageRoot}/${year}/${month}`;
        try {
            await firebaseReady;
            if (!storage) return [];

            const timeoutPromise = new Promise<T[]>((resolve) =>
                setTimeout(() => {
                    console.warn(`[BaseStorage] ⏱️ Timeout reached for ${fullStoragePath}`);
                    resolve([]);
                }, DEFAULT_FILES_TIMEOUT_MS)
            );

            const listPromise = (async () => {
                const monthRef = ref(storage, fullStoragePath);
                const result = await listAll(monthRef);

                if (result.items.length === 0) {
                    return [];
                }

                // console.debug(`[BaseStorage] 🔍 Found ${result.items.length} items in ${fullStoragePath}, fetching metadata in parallel...`);

                const filePromises = result.items.map(async (item) => {
                    try {
                        const [metadata, downloadUrl] = await Promise.all([
                            getMetadata(item),
                            getDownloadURL(item)
                        ]);

                        const parsed = config.parseFilePath(item.fullPath);

                        if (parsed) {
                            return config.mapToFile(item, metadata, downloadUrl, parsed);
                        } else {
                            console.warn(`[BaseStorage] ⚠️ File skipped (failed parsing): ${item.fullPath}`);
                            return null;
                        }
                    } catch (error) {
                        console.error(`[BaseStorage] ‼️ Error getting file info: ${item.name}`, error);
                        return null;
                    }
                });

                const filesWithNulls = await Promise.all(filePromises);
                const files = filesWithNulls.filter(f => f !== null) as T[];
                return files.sort((a, b) => b.date.localeCompare(a.date));
            })();

            return await Promise.race([listPromise, timeoutPromise]);
        } catch (error) {
            console.warn(`[BaseStorage] Error listing files for ${fullStoragePath}:`, error);
            return [];
        }
    };
};

/**
 * Utility: Format bytes to human-readable size
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i)) + ' ' + sizes[i];
};
