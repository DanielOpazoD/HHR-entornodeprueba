/**
 * Export Password Service
 * 
 * Manages passwords for census Excel exports with Firestore persistence.
 * 
 * For pure password generation without Firebase deps, use passwordGenerator.ts directly.
 */

import { getFirestore, doc, setDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getExportPasswordsPath } from '../../constants/firestorePaths';

// Re-export the pure generator for convenience
export { generateCensusPassword, getCensusPassword } from './passwordGenerator';

/**
 * Interface for stored password document
 */
export interface ExportPasswordRecord {
    date: string;
    password: string;
    createdAt: string;
    createdBy?: string;
    source?: 'email' | 'manual_download';
}

/**
 * Get all stored passwords (for audit display).
 * Returns passwords from Firestore, ordered by date descending.
 * 
 * @param maxResults - Maximum number of results to return
 * @returns Array of password records
 */
export const getStoredPasswords = async (maxResults: number = 30): Promise<ExportPasswordRecord[]> => {
    try {
        const db = getFirestore();
        const passwordsPath = getExportPasswordsPath();
        const passwordsRef = collection(db, passwordsPath);
        const q = query(passwordsRef, orderBy('date', 'desc'), limit(maxResults));

        const snapshot = await getDocs(q);
        const records: ExportPasswordRecord[] = [];

        snapshot.forEach(doc => {
            records.push(doc.data() as ExportPasswordRecord);
        });

        // console.debug(`[ExportPassword] Retrieved ${records.length} stored passwords`);
        return records;
    } catch (error) {
        console.error('[ExportPassword] Failed to get stored passwords:', error);
        return [];
    }
};

/**
 * Save a password to Firestore for audit purposes.
 * 
 * @param date - The census date in YYYY-MM-DD format
 * @param password - The password to save
 * @param createdBy - Optional user ID who triggered the generation
 * @param source - Source of the password ('email' or 'manual_download')
 */
export const savePasswordToFirestore = async (
    date: string,
    password: string,
    createdBy?: string,
    source?: 'email' | 'manual_download'
): Promise<void> => {
    try {
        const db = getFirestore();
        const passwordsPath = getExportPasswordsPath();
        const docRef = doc(db, passwordsPath, date);

        const record: ExportPasswordRecord = {
            date,
            password,
            createdAt: new Date().toISOString(),
            createdBy,
            source
        };

        await setDoc(docRef, record, { merge: true });
        // console.info(`[ExportPassword] Saved password for ${date}`);
    } catch (error) {
        console.error(`[ExportPassword] Failed to save password for ${date}:`, error);
    }
};
