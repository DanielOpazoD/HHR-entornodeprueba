/**
 * CUDYR Storage Service
 * Handles uploading CUDYR Excel files to Firebase Storage
 * 
 * Storage structure:
 * cudyr-backup/
 *   2026/
 *     01/
 *       CUDYR_08-01-2026.xlsx
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
 */
const generateCudyrPath = (date: string): string => {
    const [year, month, day] = date.split('-');
    const formattedDate = `${day}-${month}-${year}`;
    const filename = `CUDYR_${formattedDate}.xlsx`;
    return `${STORAGE_ROOT}/${year}/${month}/${filename}`;
};

/**
 * Parse file path to extract metadata
 */
const parseFilePath = (path: string): { date: string; year: string; month: string } | null => {
    const match = path.match(/CUDYR_(\d{2})-(\d{2})-(\d{4})\.xlsx$/);
    if (match) {
        return {
            date: `${match[3]}-${match[2]}-${match[1]}`, // YYYY-MM-DD
            year: match[3],
            month: match[2]
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
    console.log(`[CudyrStorage] Starting upload for ${date}...`);
    await firebaseReady;

    if (!storage) {
        throw new Error('Firebase Storage not initialized');
    }

    const filePath = generateCudyrPath(date);
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

    console.log(`✅ [CudyrStorage] Upload complete: ${filePath}`);
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
 * List all years with CUDYR backups
 */
export const listCudyrYears = createListYears(STORAGE_ROOT);

/**
 * List all months in a year
 */
export const listCudyrMonths = createListMonths(STORAGE_ROOT);

/**
 * List all files in a month
 */
export const listCudyrFilesInMonth = createListFilesInMonth<StoredCudyrFile>({
    storageRoot: STORAGE_ROOT,
    parseFilePath,
    mapToFile: (item, metadata, downloadUrl, parsed) => ({
        name: item.name,
        fullPath: item.fullPath,
        downloadUrl,
        date: parsed.date,
        year: parsed.year,
        month: parsed.month,
        createdAt: metadata.customMetadata?.uploadedAt || metadata.timeCreated,
        size: metadata.size
    })
});
