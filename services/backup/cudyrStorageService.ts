/**
 * CUDYR Storage Service
 * Handles uploading CUDYR Excel files to Firebase Storage
 * 
 * Storage structure:
 * cudyr-backup/
 *   2026/
 *     01/
 *       08-01-2026 - CUDYR.xlsx
 */

import {
    ref,
    uploadBytes,
    getDownloadURL,
    getMetadata
} from 'firebase/storage';
import { storage, auth, firebaseReady } from '../../firebaseConfig';
import {
    createListYears,
    createListMonths,
    createListFilesInMonth,
    BaseStoredFile
} from './baseStorageService';

// ============= Types =============

export interface StoredCudyrFile extends BaseStoredFile {
    month: string;
    year: string;
}

// ============= Constants =============

const STORAGE_ROOT = 'cudyr-backup';

// ============= Helper Functions =============

/**
 * Generate file path for a CUDYR Excel backup
 * New format: DD-MM-YYYY - CUDYR.xlsx
 */
const generateCudyrPath = (date: string): string => {
    const [year, month, day] = date.split('-');
    const formattedDate = `${day}-${month}-${year}`;
    const filename = `${formattedDate} - CUDYR.xlsx`;
    return `${STORAGE_ROOT}/${year}/${month}/${filename}`;
};

/**
 * Parse file path to extract metadata
 * Supports both old format (CUDYR_DD-MM-YYYY.xlsx) and new format (DD-MM-YYYY - CUDYR.xlsx)
 */
const parseFilePath = (path: string): { date: string; year: string; month: string } | null => {
    // New format: DD-MM-YYYY - CUDYR.xlsx
    const newMatch = path.match(/(\d{2})-(\d{2})-(\d{4}) - CUDYR\.xlsx$/);
    if (newMatch) {
        return {
            date: `${newMatch[3]}-${newMatch[2]}-${newMatch[1]}`, // YYYY-MM-DD
            year: newMatch[3],
            month: newMatch[2]
        };
    }

    // Old format: CUDYR_DD-MM-YYYY.xlsx (backwards compatibility)
    const oldMatch = path.match(/CUDYR_(\d{2})-(\d{2})-(\d{4})\.xlsx$/);
    if (oldMatch) {
        return {
            date: `${oldMatch[3]}-${oldMatch[2]}-${oldMatch[1]}`, // YYYY-MM-DD
            year: oldMatch[3],
            month: oldMatch[2]
        };
    }
    return null;
};

// ============= Core Functions =============

/**
 * Upload a CUDYR Excel to Firebase Storage
 */
export const uploadCudyrExcel = async (
    excelBlob: Blob,
    date: string
): Promise<string> => {
    // console.info(`[CudyrStorage] Starting upload for ${date}...`);
    await firebaseReady;

    if (!storage) {
        throw new Error('Firebase Storage not initialized');
    }

    const filePath = generateCudyrPath(date);

    // Check for and delete legacy file to prevent duplicates (CUDYR_DD-MM-YYYY.xlsx)
    try {
        const [d, m, y] = date.split('-');
        const legacyFilename = `CUDYR_${d}-${m}-${y}.xlsx`;
        const legacyPath = `${STORAGE_ROOT}/${y}/${m}/${legacyFilename}`;
        const legacyRef = ref(storage, legacyPath);

        // Check if legacy file exists
        await getMetadata(legacyRef);

        // If found, delete it
        // console.debug(`[CudyrStorage] Found legacy duplicate: ${legacyPath}, deleting...`);
        const { deleteObject } = await import('firebase/storage');
        await deleteObject(legacyRef);
        // console.debug(`[CudyrStorage] ✅ Legacy duplicate deleted`);
    } catch (ignore) {
        // Legacy file doesn't exist, proceed normally
    }

    const storageRef = ref(storage, filePath);

    const user = auth.currentUser;
    const metadata = {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        customMetadata: {
            date,
            uploadedBy: user?.email || 'unknown',
            uploadedAt: new Date().toISOString()
        }
    };

    await uploadBytes(storageRef, excelBlob, metadata);
    const downloadUrl = await getDownloadURL(storageRef);

    // console.info(`✅ [CudyrStorage] Upload complete: ${filePath}`);
    return downloadUrl;
};

/**
 * Check if a CUDYR backup exists for a date
 */
export const cudyrExists = async (date: string): Promise<boolean> => {
    const TIMEOUT_MS = 4000;
    const timeoutPromise = new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), TIMEOUT_MS)
    );

    const checkPromise = (async (): Promise<boolean> => {
        try {
            await firebaseReady;
            if (!storage) return false;

            const filePath = generateCudyrPath(date);
            const storageRef = ref(storage, filePath);

            await getMetadata(storageRef);
            return true;
        } catch (error: any) {
            if (error?.code === 'storage/object-not-found') {
                return false;
            }
            console.warn(`[CudyrStorage] Error checking:`, error.message || error);
            return false;
        }
    })();

    return await Promise.race([checkPromise, timeoutPromise]);
};

/**
 * Delete a CUDYR file from Storage
 */
export const deleteCudyrFile = async (date: string): Promise<void> => {
    const { deleteObject } = await import('firebase/storage');
    const filePath = generateCudyrPath(date);
    const storageRef = ref(storage, filePath);
    await deleteObject(storageRef);
    // console.info(`🗑️ CUDYR deleted: ${filePath}`);
};

/**
 * List all years with CUDYR backups
 */
export const listCudyrYears = createListYears(STORAGE_ROOT);

/**
 * List all months in a year
 */
export const listCudyrMonths = createListMonths(STORAGE_ROOT);

/**
 * List all files in a month
 * Note: Display name is normalized to new format (DD-MM-YYYY - CUDYR.xlsx)
 * even for older files stored with the old naming convention.
 */
export const listCudyrFilesInMonth = createListFilesInMonth<StoredCudyrFile>({
    storageRoot: STORAGE_ROOT,
    parseFilePath,
    mapToFile: (item, metadata, downloadUrl, parsed) => {
        // Generate normalized display name from parsed date (DD-MM-YYYY - CUDYR.xlsx)
        const [year, month, day] = parsed.date.split('-');
        const displayName = `${day}-${month}-${year} - CUDYR.xlsx`;

        return {
            name: displayName, // Always use normalized format for display
            fullPath: item.fullPath,
            downloadUrl,
            date: parsed.date,
            year: parsed.year,
            month: parsed.month,
            createdAt: metadata.customMetadata?.uploadedAt || metadata.timeCreated,
            size: metadata.size
        };
    }
});
