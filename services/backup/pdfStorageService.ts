/**
 * PDF Storage Service
 * Handles uploading and managing PDF files in Firebase Storage
 * 
 * Storage structure:
 * entregas-enfermeria/
 *   2026/
 *     01/
 *       2026-01-03_turno-largo.pdf
 *       2026-01-03_turno-noche.pdf
 */

import {
    ref,
    uploadBytes,
    getDownloadURL,
    listAll,
    deleteObject,
    getMetadata
} from 'firebase/storage';
import { storage, auth, firebaseReady } from '../../firebaseConfig';
import {
    MONTH_NAMES,
    createListYears,
    createListMonths,
    createListFilesInMonth,
    BaseStoredFile
} from './baseStorageService';

// ============= Types =============

export interface StoredPdfFile extends BaseStoredFile {
    shiftType: 'day' | 'night';
}

export interface PdfFolder {
    name: string;
    path: string;
    type: 'year' | 'month';
    children?: PdfFolder[];
    fileCount?: number;
}

// ============= Constants =============

const STORAGE_ROOT = 'entregas-enfermeria';

// ============= Helper Functions =============

/**
 * Generate file path for a PDF
 */
const generatePdfPath = (date: string, shiftType: 'day' | 'night'): string => {
    const [year, month, day] = date.split('-'); // input date is YYYY-MM-DD
    const shiftLabel = shiftType === 'day' ? 'Largo' : 'Noche';
    const formattedDate = `${day}-${month}-${year}`;
    const filename = `${formattedDate} - Turno ${shiftLabel}.pdf`;
    return `${STORAGE_ROOT}/${year}/${month}/${filename}`;
};

/**
 * Parse file path to extract metadata
 */
const parseFilePath = (path: string): { date: string; shiftType: 'day' | 'night' } | null => {
    // Try new format: DD-MM-YYYY - Turno Largo.pdf
    const newMatch = path.match(/(\d{2})-(\d{2})-(\d{4}) - Turno (Largo|Noche)\.pdf$/);
    if (newMatch) {
        return {
            date: `${newMatch[3]}-${newMatch[2]}-${newMatch[1]}`, // Convert back to YYYY-MM-DD
            shiftType: newMatch[4] === 'Largo' ? 'day' : 'night'
        };
    }

    // Fallback to old format: YYYY-MM-DD_turno-largo.pdf
    const oldMatch = path.match(/(\d{4}-\d{2}-\d{2})_(turno-largo|turno-noche)\.pdf$/);
    if (oldMatch) {
        return {
            date: oldMatch[1],
            shiftType: oldMatch[2] === 'turno-largo' ? 'day' : 'night'
        };
    }

    console.log(`[PdfStorage] 🔍 Failed to parse path: "${path}"`);
    return null;
};

// ============= Core Functions =============

/**
 * Upload a PDF to Firebase Storage
 */
export const uploadPdf = async (
    pdfBlob: Blob,
    date: string,
    shiftType: 'day' | 'night'
): Promise<string> => {
    console.log(`[PdfStorage] Starting upload for ${date}...`);
    await firebaseReady;

    const filePath = generatePdfPath(date, shiftType);
    const storageRef = ref(storage, filePath);

    const user = auth.currentUser;
    const metadata = {
        contentType: 'application/pdf',
        customMetadata: {
            date,
            shiftType,
            uploadedBy: user?.email || 'unknown',
            uploadedAt: new Date().toISOString()
        }
    };

    await uploadBytes(storageRef, pdfBlob, metadata);
    const downloadUrl = await getDownloadURL(storageRef);

    console.log(`✅ [PdfStorage] Upload complete: ${filePath}`);
    return downloadUrl;
};

/**
 * Delete a PDF from Storage
 */
export const deletePdf = async (date: string, shiftType: 'day' | 'night'): Promise<void> => {
    const filePath = generatePdfPath(date, shiftType);
    const storageRef = ref(storage, filePath);
    await deleteObject(storageRef);
    console.log(`🗑️ PDF deleted: ${filePath}`);
};

/**
 * Get download URL for a PDF
 */
export const getPdfUrl = async (date: string, shiftType: 'day' | 'night'): Promise<string | null> => {
    try {
        const filePath = generatePdfPath(date, shiftType);
        const storageRef = ref(storage, filePath);
        return await getDownloadURL(storageRef);
    } catch (error: any) {
        if (error?.code === 'storage/object-not-found') {
            return null;
        }
        throw error;
    }
};

/**
 * Check if a PDF exists
 */
export const pdfExists = async (date: string, shiftType: 'day' | 'night'): Promise<boolean> => {
    console.log(`[PdfStorage] 🔍 Checking existence: ${date} ${shiftType}`);

    // Create a timeout promise
    const TIMEOUT_MS = 4000;
    const timeoutPromise = new Promise<boolean>((resolve) =>
        setTimeout(() => {
            console.warn(`[PdfStorage] ⏱️ Timeout check for ${date}`);
            resolve(false);
        }, TIMEOUT_MS)
    );

    const checkPromise = (async (): Promise<boolean> => {
        try {
            await firebaseReady;
            if (!storage) return false;

            const filePath = generatePdfPath(date, shiftType);
            const storageRef = ref(storage, filePath);

            await getMetadata(storageRef);
            console.log(`[PdfStorage] ✅ Found: ${filePath}`);
            return true;
        } catch (error: any) {
            if (error?.code === 'storage/object-not-found') {
                console.log(`[PdfStorage] ℹ️ Not found: ${date} ${shiftType}`);
                return false;
            }
            console.warn(`[PdfStorage] ❌ Error (possibly CORS):`, error.message || error);
            return false;
        }
    })();

    return await Promise.race([checkPromise, timeoutPromise]);
};

/**
 * List all years with PDFs (using base service)
 */
export const listYears = createListYears(STORAGE_ROOT);

/**
 * List all months in a year (using base service)
 */
export const listMonths = createListMonths(STORAGE_ROOT);

/**
 * List all files in a month (using base service)
 */
export const listFilesInMonth = createListFilesInMonth<StoredPdfFile>({
    storageRoot: STORAGE_ROOT,
    parseFilePath,
    mapToFile: (item, metadata, downloadUrl, parsed) => ({
        name: item.name,
        fullPath: item.fullPath,
        downloadUrl,
        date: parsed.date,
        shiftType: parsed.shiftType,
        createdAt: metadata.customMetadata?.uploadedAt || metadata.timeCreated,
        size: metadata.size
    })
});

/**
 * Get folder structure for navigation
 */
export const getFolderStructure = async (): Promise<PdfFolder[]> => {
    const years = await listYears();

    const structure: PdfFolder[] = [];

    for (const year of years) {
        const months = await listMonths(year);
        structure.push({
            name: year,
            path: `${STORAGE_ROOT}/${year}`,
            type: 'year',
            children: months.map(m => ({
                name: m.name,
                path: `${STORAGE_ROOT}/${year}/${m.number}`,
                type: 'month' as const
            }))
        });
    }

    return structure;
};
