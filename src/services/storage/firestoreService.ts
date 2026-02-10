import {
    collection,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    getDocs,
    query,
    orderBy,
    Timestamp,
    onSnapshot,
    where,
    updateDoc
} from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { DailyRecord, DailyRecordPatch, ProfessionalCatalogItem } from '@/types';
import { withRetry } from '@/utils/networkUtils';

import {
    COLLECTIONS,
    HOSPITAL_COLLECTIONS,
    SETTINGS_DOCS,
    getActiveHospitalId
} from '@/constants/firestorePaths';
import { migrateLegacyData } from '../repositories/dataMigration';

// Get collection reference using typed constants
const getRecordsCollection = () => collection(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.DAILY_RECORDS
);

/**
 * Recursively convert undefined values to null for Firestore compatibility.
 * Firestore's merge mode ignores undefined values, but respects null.
 * This ensures that deleted fields (like clinicalCrib) are properly synced.
 */
const sanitizeForFirestore = (obj: unknown): unknown => {
    if (obj === undefined) {
        return null;
    }
    if (Array.isArray(obj)) {
        return obj.map(sanitizeForFirestore);
    }
    if (obj !== null && typeof obj === 'object' && !(obj instanceof Date) && !(obj instanceof Timestamp)) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = sanitizeForFirestore(v);
        }
        return result;
    }
    return obj;
};



/**
 * Convert a value to an array, handling both arrays and objects with numeric keys.
 * This fixes data corrupted when array indices were updated via dot notation.
 */
const ensureArray = (value: unknown, defaultLength: number): string[] => {
    if (Array.isArray(value)) {
        // Pad with empty strings if needed
        const result = [...value];
        while (result.length < defaultLength) {
            result.push('');
        }
        return result.slice(0, defaultLength);
    }

    // Handle object with numeric keys (corrupted array data)
    if (value && typeof value === 'object') {
        const obj = value as Record<string, string>;
        const result: string[] = [];
        for (let i = 0; i < defaultLength; i++) {
            result.push(obj[String(i)] || '');
        }
        // console.debug('[Firestore] Converted object to array:', value, '->', result);
        return result;
    }

    // Return default empty array
    return Array(defaultLength).fill('');
};



/**
 * Retrieves all dates that have records in Firestore.
 */
export const getAvailableDatesFromFirestore = async (): Promise<string[]> => {
    try {
        const q = query(
            getRecordsCollection()
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => doc.id).sort().reverse();
    } catch (error) {
        console.error('[Firestore] Error fetching available dates:', error);
        return [];
    }
};

// Convert Firestore data to DailyRecord
// Uses Zod for validation with graceful defaults for missing fields
const docToRecord = (docData: Record<string, unknown>, docId: string): DailyRecord => {
    // 1. Transform Firestore-specific types (Timestamp) to strings BEFORE validation
    const rawData = { ...docData };

    if (rawData.lastUpdated instanceof Timestamp) {
        rawData.lastUpdated = rawData.lastUpdated.toDate().toISOString();
    }

    // 1.5 Pre-process arrays that might be returned as objects by Firestore (indexed updates)
    rawData.nurses = ensureArray(rawData.nurses, 2);
    rawData.nursesDayShift = ensureArray(rawData.nursesDayShift, 2);
    rawData.nursesNightShift = ensureArray(rawData.nursesNightShift, 2);
    rawData.tensDayShift = ensureArray(rawData.tensDayShift, 3);
    rawData.tensNightShift = ensureArray(rawData.tensNightShift, 3);

    const nursesArr = rawData.nurses as string[];
    const dayShiftArr = rawData.nursesDayShift as string[];

    // MIGRATION: If new shifts are empty but old 'nurses' has data, copy it.
    if (nursesArr.length > 0 && dayShiftArr.every(n => !n)) {
        rawData.nursesDayShift = [...nursesArr];
    }
    // MIGRATION: If nurseName (single string) is present but shift 0 is empty
    if (typeof rawData.nurseName === 'string' && rawData.nurseName && !dayShiftArr[0]) {
        (rawData.nursesDayShift as string[])[0] = rawData.nurseName;
    }

    rawData.activeExtraBeds = Array.isArray(rawData.activeExtraBeds) ? rawData.activeExtraBeds : [];

    // 2. Use migration logic + Zod to validate and apply defaults (soft validation)
    // This handles legacy record transformation and schema invariants.
    return migrateLegacyData(rawData as unknown as DailyRecord, docId);
};

/**
 * Saves a snapshot of the current record to a history sub-collection.
 * This ensures compliance with MINSAL "Integrity" pillar (no deletion of clinical data).
 */
const saveHistorySnapshot = async (date: string): Promise<void> => {
    try {
        const docRef = doc(getRecordsCollection(), date);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const historyRef = doc(collection(docRef, 'history'), new Date().toISOString());

            // Re-package with current timestamp as record of when it was the "active" state
            await setDoc(historyRef, {
                ...data,
                snapshotTimestamp: Timestamp.now()
            });
            // console.info(`📜 History snapshot created for ${date}`);
        }
    } catch (error) {
        // We log but don't throw to avoid blocking the main save operation
        console.error('❌ Failed to create history snapshot:', error);
    }
};

/**
 * Saves a complete DailyRecord to Firestore.
 * Performs sanitization to ensure compatibility with Firestore.
 * 
 * @param record - The DailyRecord object to persist
 * @returns Promise that resolves when the save operation is finished
 * 
 * @example
 * ```typescript
 * await saveRecordToFirestore(myRecord);
 * ```
 */
export class ConcurrencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConcurrencyError';
    }
}

/**
 * Saves a complete DailyRecord to Firestore.
 * Performs sanitization to ensure compatibility with Firestore.
 * 
 * @param record - The DailyRecord object to persist
 * @param expectedLastUpdated - Optional ISO timestamp of the base version we are editing from.
 *                              Used for optimistic concurrency control.
 * @returns Promise that resolves when the save operation is finished
 */
export const saveRecordToFirestore = async (record: DailyRecord, expectedLastUpdated?: string): Promise<void> => {
    try {
        const docRef = doc(getRecordsCollection(), record.date);

        // Optimistic Concurrency Check
        if (expectedLastUpdated) {
            // We use a transaction or simple read-before-write. 
            // Since we want offline support for writes, we only check if we can read fresh data.
            // If getDoc fails (offline), we assume it's safe to write (Last Write Wins locally).
            try {
                const remoteDoc = await getDoc(docRef);
                if (remoteDoc.exists()) {
                    const remoteData = remoteDoc.data();
                    const remoteLastUpdated = remoteData.lastUpdated instanceof Timestamp
                        ? remoteData.lastUpdated.toDate().toISOString()
                        : (remoteData.lastUpdated as string);

                    if (remoteLastUpdated && new Date(remoteLastUpdated) > new Date(expectedLastUpdated)) {
                        console.warn(`[Firestore] Concurrency conflict. Remote: ${remoteLastUpdated}, Local base: ${expectedLastUpdated}`);
                        throw new ConcurrencyError('El registro ha sido modificado por otro usuario. Por favor recarga la página.');
                    }
                }
            } catch (err) {
                // If checking fails (e.g. offline), or checking logic throws ConcurrencyError, rethrow ConcurrencyError
                if (err instanceof ConcurrencyError) throw err;
                // Otherwise (network error on read), we proceed to save (optimistic offline behavior)
                console.warn('[Firestore] Could not verify concurrency (likely offline), proceeding with save.');
            }
        }

        // MINSAL Integrity: Save snapshot of current state before overwriting
        await saveHistorySnapshot(record.date);

        // Sanitize data to convert undefined to null
        // This ensures deletions (like removing clinicalCrib) are properly synced
        const sanitizedRecord = sanitizeForFirestore({
            ...record,
            lastUpdated: Timestamp.now()
        });

        // Use setDoc WITHOUT merge to ensure deletions are reflected
        await withRetry(() => setDoc(docRef, sanitizedRecord as Record<string, unknown>), {
            onRetry: (err: unknown, attempt: number) => console.warn(`[Firestore] Retry ${attempt} saving record ${record.date}:`, err)
        });
        // console.info('✅ Saved to Firestore:', record.date);
    } catch (error) {
        console.error('❌ Error saving to Firestore:', error);
        throw error;
    }
};

/**
 * Performs a partial update to a DailyRecord in Firestore using dot-notation paths.
 * This is efficient as it only modifies the specified fields.
 * 
 * @param date - The date identifier (YYYY-MM-DD)
 * @param partialData - Object containing flattened key paths
 * @returns Promise that resolves when the update is finished
 * 
 * @example
 * ```typescript
 * await updateRecordPartial('2024-12-24', { 'beds.BED_01.isBlocked': true });
 * ```
 */
/**
 * Flattens a nested object into a single-level object with dot-notation keys.
 * Used for Firestore partial updates to avoid overwriting nested objects.
 */
const flattenObject = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
        return prefix ? { [prefix]: {} } : {};
    }

    return keys.reduce((acc: Record<string, unknown>, k) => {
        const pre = prefix.length ? prefix + '.' : '';
        const val = obj[k];
        if (
            typeof val === 'object' &&
            val !== null &&
            !Array.isArray(val) &&
            !(val instanceof Date) &&
            !(val instanceof Timestamp)
        ) {
            Object.assign(acc, flattenObject(val as Record<string, unknown>, pre + k));
        } else {
            acc[pre + k] = val;
        }
        return acc;
    }, {});
};

/**
 * Performs a partial update to a DailyRecord in Firestore using dot-notation paths.
 * This is efficient as it only modifies the specified fields.
 */
export const updateRecordPartial = async (date: string, partialData: DailyRecordPatch): Promise<void> => {
    try {
        const docRef = doc(getRecordsCollection(), date);

        // MINSAL Integrity: Save snapshot of current state before partial update
        await saveHistorySnapshot(date);

        // Flatten the data to handle nested fields correctly (dot-notation)
        // and add timestamp
        const flatData = flattenObject(partialData as unknown as Record<string, unknown>);
        const sanitizedData = sanitizeForFirestore({
            ...flatData,
            lastUpdated: Timestamp.now()
        }) as Record<string, unknown>;

        try {
            await withRetry(() => updateDoc(docRef as any, sanitizedData as any), {
                onRetry: (err: unknown, attempt: number) => console.warn(`[Firestore] Retry ${attempt} updating record ${date}:`, err)
            });
        } catch (error: unknown) {
            const storageError = error as { code?: string };
            // Error code for document not found in Firebase
            if (storageError?.code === 'not-found') {
                console.warn(`[Firestore] Document ${date} not found for partial update. Creating with setDoc.`);
                // Use setDoc with merge: true to create the document
                await withRetry(() => setDoc(docRef, sanitizedData, { merge: true }));
            } else {
                throw error;
            }
        }
        // console.info('✅ Partial update to Firestore (flattened):', date, Object.keys(flatData));
    } catch (error) {
        console.error('❌ Error in partial update to Firestore:', error);
        throw error;
    }
};

/**
 * Retrieves a DailyRecord from Firestore for a specific date.
 * 
 * @param date - Date identifier in YYYY-MM-DD format
 * @returns The DailyRecord if found, null otherwise
 */
export const getRecordFromFirestore = async (date: string): Promise<DailyRecord | null> => {
    try {
        const docRef = doc(getRecordsCollection(), date);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docToRecord(docSnap.data(), date);
        }
        return null;
    } catch (error) {
        console.error('❌ Error getting record from Firestore:', error);
        return null;
    }
};

// Delete a record from Firestore
export const deleteRecordFromFirestore = async (date: string): Promise<void> => {
    try {
        const docRef = doc(getRecordsCollection(), date);
        await withRetry(() => deleteDoc(docRef), {
            onRetry: (err: unknown, attempt: number) => console.warn(`[Firestore] Retry ${attempt} deleting record ${date}:`, err)
        });
        // console.info('🗑️ Deleted from Firestore:', date);
    } catch (error) {
        console.error('❌ Error deleting from Firestore:', error);
        throw error;
    }
};

// Get all records from Firestore
export const getAllRecordsFromFirestore = async (): Promise<Record<string, DailyRecord>> => {
    try {
        const q = query(getRecordsCollection(), orderBy('date', 'desc'));
        const querySnapshot = await getDocs(q);

        const records: Record<string, DailyRecord> = {};
        querySnapshot.forEach((doc) => {
            records[doc.id] = docToRecord(doc.data(), doc.id);
        });

        return records;
    } catch (error) {
        console.error('❌ Error getting all records from Firestore:', error);
        return {};
    }
};

// Get records for a specific month
export const getMonthRecordsFromFirestore = async (year: number, month: number): Promise<DailyRecord[]> => {
    try {
        const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month + 1).padStart(2, '0')}-31`;

        return getRecordsRangeFromFirestore(startDate, endDate);
    } catch (error) {
        console.error('❌ Error getting month records:', error);
        return [];
    }
};

/**
 * Retrieves daily records within a specific date range from Firestore.
 * 
 * @param startDate - Range start (YYYY-MM-DD)
 * @param endDate - Range end (YYYY-MM-DD)
 * @returns Array of DailyRecord objects
 */
export const getRecordsRangeFromFirestore = async (startDate: string, endDate: string): Promise<DailyRecord[]> => {
    try {
        const q = query(
            getRecordsCollection(),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
            orderBy('date', 'asc')
        );

        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => docToRecord(doc.data(), doc.id));
    } catch (error) {
        console.error(`❌ Error getting records for range ${startDate} to ${endDate}:`, error);
        return [];
    }
};

// Real-time listener for a specific date
export const subscribeToRecord = (
    date: string,
    callback: (record: DailyRecord | null, hasPendingWrites: boolean) => void
): (() => void) => {
    const docRef = doc(getRecordsCollection(), date);

    return onSnapshot(docRef, { includeMetadataChanges: true }, (docSnap) => {
        const hasPendingWrites = docSnap.metadata.hasPendingWrites;
        if (docSnap.exists()) {
            callback(docToRecord(docSnap.data(), date), hasPendingWrites);
        } else {
            callback(null, hasPendingWrites);
        }
    }, (error) => {
        console.error('❌ Firestore subscription error:', error);
        callback(null, false);
    });
};

// Check if Firestore is available (online)
export const isFirestoreAvailable = async (): Promise<boolean> => {
    try {
        // Try a simple read operation
        const docRef = doc(db, 'hospitals', getActiveHospitalId());
        await getDoc(docRef); // Reverted to original getDoc as partialData was undefined
        return true;
    } catch (_error) {
        return false;
    }
};

// ============================================================================
// Nurse Catalog Persistence
// ============================================================================

/**
 * Get the nurse catalog from Firestore
 */
export const getNurseCatalogFromFirestore = async (): Promise<string[]> => {
    try {
        const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, SETTINGS_DOCS.NURSES);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return (data.list as string[]) || [];
        }
        return [];
    } catch (error) {
        console.error('Error fetching nurse catalog from Firestore:', error);
        return [];
    }
};

/**
 * Save the nurse catalog to Firestore
 */
export const saveNurseCatalogToFirestore = async (nurses: string[]): Promise<void> => {
    try {
        const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, SETTINGS_DOCS.NURSES);
        await withRetry(() => setDoc(docRef, {
            list: nurses,
            lastUpdated: new Date().toISOString()
        }));
        // console.info('✅ Nurse catalog saved to Firestore');
    } catch (error) {
        console.error('Error saving nurse catalog to Firestore:', error);
        throw error;
    }
};

/**
 * Subscribe to nurse catalog changes in real-time
 */
export const subscribeToNurseCatalog = (callback: (nurses: string[]) => void): (() => void) => {
    const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, SETTINGS_DOCS.NURSES);
    // console.info('[Firestore] Setting up nurse catalog subscription...');

    return onSnapshot(docRef, (docSnap) => {
        // console.debug('[Firestore] Nurse catalog snapshot received, exists:', docSnap.exists());
        if (docSnap.exists()) {
            const data = docSnap.data();
            const nurses = (data.list as string[]) || [];
            // console.debug('[Firestore] Nurse catalog data:', nurses);
            callback(nurses);
        } else {
            // Document doesn't exist yet in Beta. We don't overwrite local/migrated data here.
            // console.debug('[Firestore] Nurse catalog document does not exist yet');
        }
    }, (error) => {
        console.error('❌ Error subscribing to nurse catalog:', error);
        callback([]);
    });
};




// ============================================================================
// TENS Catalog Persistence
// ============================================================================

/**
 * Get the TENS catalog from Firestore
 */
export const getTensCatalogFromFirestore = async (): Promise<string[]> => {
    try {
        const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, SETTINGS_DOCS.TENS);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return (data.list as string[]) || [];
        }
        return [];
    } catch (error) {
        console.error('Error fetching TENS catalog from Firestore:', error);
        return [];
    }
};

/**
 * Save the TENS catalog to Firestore
 */
export const saveTensCatalogToFirestore = async (tens: string[]): Promise<void> => {
    try {
        const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, SETTINGS_DOCS.TENS);
        await withRetry(() => setDoc(docRef, {
            list: tens,
            lastUpdated: new Date().toISOString()
        }));
        // console.info('✅ TENS catalog saved to Firestore');
    } catch (error) {
        console.error('Error saving TENS catalog to Firestore:', error);
        throw error;
    }
};

/**
 * Subscribe to TENS catalog changes in real-time
 */
export const subscribeToTensCatalog = (callback: (tens: string[]) => void): (() => void) => {
    const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, SETTINGS_DOCS.TENS);
    // console.info('[Firestore] Setting up TENS catalog subscription...');

    return onSnapshot(docRef, (docSnap) => {
        // console.debug('[Firestore] TENS catalog snapshot received, exists:', docSnap.exists());
        if (docSnap.exists()) {
            const data = docSnap.data();
            const tens = (data.list as string[]) || [];
            // console.debug('[Firestore] TENS catalog data:', tens);
            callback(tens);
        } else {
            // Document doesn't exist yet in Beta. We don't overwrite local/migrated data here.
            // console.debug('[Firestore] TENS catalog document does not exist yet');
        }
    }, (error) => {
        console.error('❌ Error subscribing to TENS catalog:', error);
        callback([]);
    });
};

// ============================================================================
// Soft Delete / Trash Management
// ============================================================================

/**
 * Soft delete: Move a record to a dedicated trash collection before permanent deletion.
 * Provides a safety net for accidental data loss.
 */
export const moveRecordToTrash = async (record: DailyRecord): Promise<void> => {
    try {
        const trashRef = doc(
            db,
            COLLECTIONS.HOSPITALS,
            getActiveHospitalId(),
            HOSPITAL_COLLECTIONS.DELETED_RECORDS,
            `${record.date}_trash_${new Date().getTime()}`
        );

        await withRetry(() => setDoc(trashRef, {
            ...sanitizeForFirestore(record) as Record<string, unknown>,
            deletedAt: Timestamp.now(),
            originalDate: record.date
        }));
        // console.info('♻️ Record moved to trash:', record.date);
    } catch (error) {
        console.error('❌ Error moving record to trash:', error);
        throw error;
    }
};

// ============================================================================
// Professionals Catalog Persistence
// ============================================================================

/**
 * Get the professionals catalog from Firestore
 */
export const getProfessionalsCatalogFromFirestore = async (): Promise<ProfessionalCatalogItem[]> => {
    try {
        const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, 'professionals_catalog');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return (data.list as ProfessionalCatalogItem[]) || [];
        }
        return [];
    } catch (error) {
        console.error('Error fetching professionals catalog from Firestore:', error);
        return [];
    }
};

/**
 * Save the professionals catalog to Firestore
 */
export const saveProfessionalsCatalogToFirestore = async (professionals: ProfessionalCatalogItem[]): Promise<void> => {
    try {
        const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, 'professionals_catalog');
        await withRetry(() => setDoc(docRef, {
            list: professionals,
            lastUpdated: new Date().toISOString()
        }));
    } catch (error) {
        console.error('Error saving professionals catalog to Firestore:', error);
        throw error;
    }
};

/**
 * Subscribe to professionals catalog changes in real-time
 */
export const subscribeToProfessionalsCatalog = (callback: (professionals: ProfessionalCatalogItem[]) => void): (() => void) => {
    const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, 'professionals_catalog');

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const professionals = (data.list as ProfessionalCatalogItem[]) || [];
            callback(professionals);
        }
    }, (error) => {
        console.error('❌ Error subscribing to professionals catalog:', error);
        callback([]);
    });
};
