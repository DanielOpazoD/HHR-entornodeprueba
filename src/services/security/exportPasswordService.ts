/**
 * Export Password Service
 *
 * Manages passwords for census Excel exports with Firestore persistence.
 *
 * For pure password generation without Firebase deps, use passwordGenerator.ts directly.
 */

import { doc, setDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getExportPasswordsPath } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { exportPasswordLogger } from '@/services/security/securityLoggers';

// Re-export the pure generator for convenience
export { generateCensusPassword, getCensusPassword } from '../../utils/passwordGenerator';

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

interface ExportPasswordPersistenceService {
  getStoredPasswords: (maxResults?: number) => Promise<ExportPasswordRecord[]>;
  savePasswordToFirestore: (
    date: string,
    password: string,
    createdBy?: string,
    source?: 'email' | 'manual_download'
  ) => Promise<void>;
}

type ExportPasswordRuntime =
  | Pick<FirestoreServiceRuntimePort, 'getDb'>
  | {
      db: ReturnType<FirestoreServiceRuntimePort['getDb']>;
    };

const resolveDb = (runtime: ExportPasswordRuntime) =>
  'getDb' in runtime ? runtime.getDb() : runtime.db;

export const createExportPasswordPersistenceService = (
  runtime: ExportPasswordRuntime = defaultFirestoreServiceRuntime
): ExportPasswordPersistenceService => ({
  getStoredPasswords: async (maxResults = 30): Promise<ExportPasswordRecord[]> => {
    try {
      const passwordsPath = getExportPasswordsPath();
      const passwordsRef = collection(resolveDb(runtime), passwordsPath);
      const q = query(passwordsRef, orderBy('date', 'desc'), limit(maxResults));

      const snapshot = await getDocs(q);
      const records: ExportPasswordRecord[] = [];

      snapshot.forEach(passwordDoc => {
        records.push(passwordDoc.data() as ExportPasswordRecord);
      });

      return records;
    } catch (error) {
      exportPasswordLogger.error('Failed to get stored passwords', error);
      return [];
    }
  },
  savePasswordToFirestore: async (date, password, createdBy, source): Promise<void> => {
    try {
      const passwordsPath = getExportPasswordsPath();
      const docRef = doc(resolveDb(runtime), passwordsPath, date);

      const record: ExportPasswordRecord = {
        date,
        password,
        createdAt: new Date().toISOString(),
        createdBy,
        source,
      };

      await setDoc(docRef, record, { merge: true });
    } catch (error) {
      exportPasswordLogger.error(`Failed to save password for ${date}`, error);
    }
  },
});

const defaultExportPasswordPersistenceService = createExportPasswordPersistenceService();

/**
 * Get all stored passwords (for audit display).
 * Returns passwords from Firestore, ordered by date descending.
 *
 * @param maxResults - Maximum number of results to return
 * @returns Array of password records
 */
export const getStoredPasswords = async (
  maxResults: number = 30
): Promise<ExportPasswordRecord[]> => {
  return defaultExportPasswordPersistenceService.getStoredPasswords(maxResults);
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
  return defaultExportPasswordPersistenceService.savePasswordToFirestore(
    date,
    password,
    createdBy,
    source
  );
};
