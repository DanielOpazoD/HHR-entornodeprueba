/**
 * Daily Record Repository
 * Provides a unified interface for accessing and persisting daily records.
 * Abstracts localStorage and Firestore operations.
 * Supports demo mode with isolated storage.
 */

import { DailyRecord, PatientData, BedType } from '@/types';
import { DailyRecordPatch } from '@/types';
import { BEDS } from '@/constants';
import {
    getRecordForDate as getRecordFromIndexedDB,
    getPreviousDayRecord as getPreviousDayFromIndexedDB,
    saveRecord as saveToIndexedDB,
    deleteRecord as deleteFromIndexedDB,
    getAllDates as getAllDatesFromIndexedDB,
    getAllDemoRecords as getAllDemoRecordsFromIndexedDB,
    saveDemoRecord,
    getDemoRecordForDate,
    getPreviousDemoDayRecord,
    deleteDemoRecord
} from '../storage/indexedDBService';
import {
    saveRecordToFirestore,
    subscribeToRecord,
    deleteRecordFromFirestore,
    updateRecordPartial,
    getRecordFromFirestore,
    moveRecordToTrash,
    getAvailableDatesFromFirestore
} from '../storage/firestoreService';
import { getLegacyRecord } from '../storage/legacyFirebaseService';
import { CURRENT_SCHEMA_VERSION } from '@/constants/version';
// import {
//     getActiveHospitalId
// } from '@/constants/firestorePaths';
import { createEmptyPatient, clonePatient } from '../factories/patientFactory';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import { validateAndSalvageRecord } from './helpers/validationHelper';
import { applyPatches } from '@/utils/patchUtils';
import { checkRegression, DataRegressionError, calculateDensity, VersionMismatchError } from '@/utils/integrityGuard';
import { mapPatientToFhir } from '@/services/utils/fhirMappers';
import { logError } from '@/services/utils/errorService';

// ============================================================================
// Configuration (imported from repositoryConfig)
// ============================================================================

export { setFirestoreEnabled, isFirestoreEnabled, setDemoModeActive, isDemoModeActive } from './repositoryConfig';
import { isFirestoreEnabled, isDemoModeActive } from './repositoryConfig';

// Re-export from dedicated modules
export { CatalogRepository } from './CatalogRepository';
import { migrateLegacyData } from './dataMigration';
export { migrateLegacyData } from './dataMigration';
export { ensureMonthIntegrity } from './monthIntegrity';
export type { MonthIntegrityResult } from './monthIntegrity';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IDailyRecordRepository {
    getForDate(date: string): Promise<DailyRecord | null>;
    getPreviousDay(date: string): Promise<DailyRecord | null>;
    save(record: DailyRecord, expectedLastUpdated?: string): Promise<void>;
    subscribe(date: string, callback: (r: DailyRecord | null, hasPendingWrites: boolean) => void): () => void;
    initializeDay(date: string, copyFromDate?: string): Promise<DailyRecord>;
    deleteDay(date: string): Promise<void>;
    getAllDates(): Promise<string[]>;
    updatePartial(date: string, patches: DailyRecordPatch): Promise<void>;
    copyPatientToDate(sourceDate: string, sourceBedId: string, targetDate: string, targetBedId: string): Promise<void>;
}

// ============================================================================
// Repository Implementation
// ============================================================================


/**
 * Retrieves the daily record for a specific date.
 * First tries IndexedDB (fast), then syncs from Firestore if online and local is empty.
 * 
 * @param date - Date in YYYY-MM-DD format
 * @param syncFromRemote - If true, also check Firestore when local is empty
 * @returns The daily record if it exists, null otherwise
 */
export const getForDate = async (date: string, syncFromRemote: boolean = true): Promise<DailyRecord | null> => {
    // 0. E2E Override Hook (for stable VRT/Tests)
    if (typeof window !== 'undefined' && window.__HHR_E2E_OVERRIDE__) {
        const override = window.__HHR_E2E_OVERRIDE__;
        if (override[date]) {
            console.warn(`[E2E] Using override record for ${date}`);
            return migrateLegacyData(override[date], date);
        }
    }

    if (isDemoModeActive()) {
        return await getDemoRecordForDate(date);
    }

    // 1. Try local first (fast)
    const localRecord = await getRecordFromIndexedDB(date);
    if (localRecord) {
        return migrateLegacyData(localRecord, date);
    }

    // 2. If no local record and sync is enabled, try Firestore
    if (syncFromRemote && isFirestoreEnabled()) {
        try {
            console.warn(`[Repository DEBUG] Attempting Firestore fetch for ${date}`);
            const remoteRecord = await getRecordFromFirestore(date);
            if (remoteRecord) {
                const migrated = migrateLegacyData(remoteRecord, date);
                // Cache it locally for next time
                await saveToIndexedDB(migrated);
                return migrated;
            }

            // 3. Fallback to Legacy Production (Solo Lectura - hospital-hanga-roa)
            // eslint-disable-next-line no-console
            console.log(`[Repository] 🔍 Checking legacy fallback for ${date}...`);
            const legacyRecord = await getLegacyRecord(date);
            if (legacyRecord) {
                // eslint-disable-next-line no-console
                console.log(`[Repository] 🎯 Found legacy record for ${date}. Migrating to Beta.`);
                const migrated = migrateLegacyData(legacyRecord, date);
                // Cache it locally so it can be edited and saved to Beta
                await saveToIndexedDB(migrated);
                return migrated;
            }
        } catch (err) {
            console.warn(`[Repository] getForDate: Remote fetch failed for ${date}:`, err);
        }
    }

    return localRecord ? migrateLegacyData(localRecord, date) : null;
};


/**
 * Retrieves the previous day's record relative to the given date.
 * 
 * @param date - Reference date in YYYY-MM-DD format
 * @returns The previous day's record if it exists, null otherwise
 */
export const getPreviousDay = async (date: string): Promise<DailyRecord | null> => {
    if (isDemoModeActive()) {
        return await getPreviousDemoDayRecord(date);
    }

    // 1. Try local first
    const localRecord = await getPreviousDayFromIndexedDB(date);
    if (localRecord) {
        return migrateLegacyData(localRecord, localRecord.date);
    }

    // 2. If no local, try remote or calculated previous
    if (isFirestoreEnabled()) {
        try {
            // Find most recent record BEFORE 'date'
            const allDates = await getAvailableDates();
            const prevDate = allDates.find(d => d < date);

            if (prevDate) {
                return await getForDate(prevDate);
            }
        } catch (err) {
            console.warn('[Repository] getPreviousDay remote check failed:', err);
        }
    }

    return null;
};

/**
 * Retrieves all dates that have patient records.
 * Used for the "copy from any day" feature.
 * 
 * @returns Array of date strings (YYYY-MM-DD) sorted descending (most recent first)
 */
/**
 * Retrieves all dates that have patient records.
 * Used for the "copy from any day" feature.
 * 
 * @returns Array of date strings (YYYY-MM-DD) sorted descending (most recent first)
 */
export const getAvailableDates = async (): Promise<string[]> => {
    if (isDemoModeActive()) {
        const records = await getAllDemoRecordsFromIndexedDB();
        return Object.keys(records).sort().reverse();
    }

    const localDates = await getAllDatesFromIndexedDB();

    if (isFirestoreEnabled()) {
        try {
            const remoteDates = await getAvailableDatesFromFirestore();
            // Merge and de-duplicate
            const allDates = Array.from(new Set([...localDates, ...remoteDates]));
            return allDates.sort().reverse();
        } catch (err) {
            console.warn('[Repository] Failed to fetch remote dates:', err);
        }
    }

    return localDates.sort().reverse();
};

/**
 * Saves a daily record to storage with strict Zod validation and regression guards.
 * 
 * Clinical Justification: 
 * 1. Zod Validation: Guarantees that the document always contains required medical fields.
 * 2. Regression Guard: Detects massive data drops (e.g. accidentally deleting half the patients), 
 *    blocking the save to prevent irreversible loss of clinical census data.
 * 3. FHIR Enrichment: Prepares data for future interoperability with other hospital systems.
 * 
 * @param record - The daily record to save
 * @param expectedLastUpdated - Optional ISO timestamp for concurrency check
 * @throws DataRegressionError if a suspicious drop in patient count is detected
 * @throws VersionMismatchError if the cloud has a newer schema version
 */
export const save = async (record: DailyRecord, expectedLastUpdated?: string): Promise<void> => {
    if (isDemoModeActive()) {
        await saveDemoRecord(record);
        return;
    }

    // 1. Mandatory Schema Validation (The "Lock")
    // Use the helper to ensure the document always contains required medical fields.
    const recordWithSchemaDefaults = validateAndSalvageRecord(record, record.date);

    // Ensure dateTimestamp is present for security rules (legacy records fix)
    if (!recordWithSchemaDefaults.dateTimestamp && recordWithSchemaDefaults.date) {
        const dateObj = new Date(recordWithSchemaDefaults.date + 'T00:00:00');
        recordWithSchemaDefaults.dateTimestamp = dateObj.getTime();
    }

    // Enforce core invariants before enrichment/persist
    const normalized = normalizeDailyRecordInvariants(recordWithSchemaDefaults);
    const validatedRecord = normalized.record;
    if (Object.keys(normalized.patches).length > 0) {
        logError('Invariant repair applied on save', undefined, {
            date: validatedRecord.date,
            patches: Object.keys(normalized.patches),
        });
    }

    // FHIR Enrichment Layer (Dual Mode)
    Object.keys(validatedRecord.beds).forEach(bedId => {
        const patient = validatedRecord.beds[bedId];
        if (patient && patient.patientName && patient.patientName.trim()) {
            patient.fhir_resource = mapPatientToFhir(patient);
            if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
                patient.clinicalCrib.fhir_resource = mapPatientToFhir(patient.clinicalCrib);
            }
        }
    });

    // 2. Data Integrity Check (Regression Guard)
    if (isFirestoreEnabled()) {
        try {
            const remoteRecord = await getRecordFromFirestore(record.date);
            if (remoteRecord) {
                // A. Version Check (Schema Guard)
                const remoteVersion = remoteRecord.schemaVersion || 0;
                if (remoteVersion > CURRENT_SCHEMA_VERSION) {
                    throw new VersionMismatchError(
                        `Tu aplicación está desactualizada (v${CURRENT_SCHEMA_VERSION}) y el registro en la nube usa el nuevo formato v${remoteVersion}.`
                    );
                }

                // B. Data Integrity Check (Regression Guard)
                const { isSuspicious, dropPercentage } = checkRegression(remoteRecord, validatedRecord);
                if (isSuspicious) {
                    throw new DataRegressionError(
                        `Se detectó una pérdida masiva de datos (${dropPercentage.toFixed(1)}%). El guardado fue bloqueado.`,
                        calculateDensity(validatedRecord),
                        calculateDensity(remoteRecord)
                    );
                }
            }
        } catch (err) {
            if (err instanceof DataRegressionError || err instanceof VersionMismatchError) throw err;
            console.warn('[Repository] Could not perform integrity check, proceeding:', err);
        }
    }

    // Always set current version before saving
    validatedRecord.schemaVersion = CURRENT_SCHEMA_VERSION;

    // Save to IndexedDB (Local Primary Storage)
    await saveToIndexedDB(validatedRecord);

    // Sync to Firestore in background
    if (isFirestoreEnabled()) {
        try {
            await saveRecordToFirestore(validatedRecord, expectedLastUpdated);
        } catch (err) {
            console.warn('Firestore sync failed, data saved in IndexedDB:', err);
            // Re-throw critical errors only
            if (err instanceof Error && (err.name === 'ConcurrencyError' || err instanceof DataRegressionError)) {
                throw err;
            }
        }
    }

    // 3. Silent Master Patient Index Sync (Fire and Forget)
    // This feeds the "Local Memory" for future autocompletion
    setTimeout(async () => {
        try {
            const { PatientMasterRepository } = await import('./PatientMasterRepository');
            const patientsToSync: PatientData[] = [];

            // Collect unique patients from beds
            Object.values(validatedRecord.beds).forEach(patient => {
                if (patient.patientName?.trim() && patient.rut?.trim()) {
                    patientsToSync.push(patient);
                }
                // Also check clinical cribs
                if (patient.clinicalCrib?.patientName?.trim() && patient.clinicalCrib?.rut?.trim()) {
                    patientsToSync.push(patient.clinicalCrib);
                }
            });

            // Parallel upsert (limit concurrency if needed, but for <25 beds Promise.all is fine)
            if (patientsToSync.length > 0) {
                // We use map to just feed the minimal needed data for the master index
                // Note: upsertPatient handles validation internally
                await Promise.all(patientsToSync.map(p => PatientMasterRepository.upsertPatient({
                    rut: p.rut!,
                    fullName: p.patientName!,
                    birthDate: p.birthDate,
                    forecast: p.insurance, // Mapping 'insurance' to 'forecast' as per MasterPatient type
                    gender: p.biologicalSex
                })));
                // console.debug(`[Repository] Silently synced ${patientsToSync.length} patients to Master Index`);
            }
        } catch (_err) {
            // e.g. console.debug('Silent Background Sync Error:', err); (suppressed for prod)
        }
    }, 1000); // 1s delay to prioritize UI responsiveness
};

/**
 * Updates specific fields of a daily record using a "Cell-Level Last Write Wins" strategy.
 * 
 * Clinical Justification: 
 * Allows multiple clinicians (e.g. Nurses at different stations) to edit the same censo
 * simultaneously. If Nurse A edits Bed 1 and Nurse B edits Bed 2, both changes ARE preserved. 
 * This prevents critical updates from being overwritten by other staff members.
 * 
 * @param date - Record identifier
 * @param partialData - Granular patches (dot-notation keys)
 * @throws Error if the resulting record fails schema validation
 */
export const updatePartial = async (date: string, partialData: DailyRecordPatch): Promise<void> => {
    // 1. Load current state (Local always serves as the reference for the outgoing patch)
    const current = isDemoModeActive()
        ? await getDemoRecordForDate(date)
        : await getRecordFromIndexedDB(date);

    if (!current) {
        console.warn(`[Repository] updatePartial: No record found for ${date}, operation aborted.`);
        return;
    }

    // 2. Apply Patches & Validate Merged Result (The "Lock")
    const updatedForInvariants = applyPatches(current, partialData);
    const normalized = normalizeDailyRecordInvariants(updatedForInvariants);
    const mergedPatches: DailyRecordPatch = { ...partialData, ...normalized.patches };

    if (Object.keys(normalized.patches).length > 0) {
        logError('Invariant repair applied on updatePartial', undefined, {
            date,
            patches: Object.keys(normalized.patches),
        });
    }

    const updated = applyPatches(current, mergedPatches);
    updated.lastUpdated = new Date().toISOString();

    const validatedRecord = validateAndSalvageRecord(updated, date);

    // 3. Local Persistence
    if (isDemoModeActive()) {
        await saveDemoRecord(validatedRecord);
        return; // No Firestore sync in demo
    }
    await saveToIndexedDB(validatedRecord);

    // 4. Remote Sync (Cell-Level LWW)
    if (isFirestoreEnabled()) {
        try {
            // Enhancement: Automatically regenerate FHIR resources for affected beds
            Object.keys(mergedPatches).forEach(key => {
                if (key.startsWith('beds.')) {
                    const bedId = key.split('.')[1];
                    const patient = validatedRecord.beds[bedId];
                    if (patient && patient.patientName) {
                        const fhirPath = `beds.${bedId}.fhir_resource` as keyof DailyRecordPatch;
                        const fhirResource = mapPatientToFhir(patient);
                        mergedPatches[fhirPath] = fhirResource;
                    }
                }
            });

            // Flattening and updating only the granular keys ensures that if User A 
            // edits Bed 1 and User B edits Bed 2, both successfully merge in Firestore (Cell-Level LWW).
            await updateRecordPartial(date, mergedPatches);
        } catch (err) {
            console.warn('[Repository] Firestore partial update failed:', err);
        }
    }
};

/**
 * Subscribes to real-time updates for a specific date.
 */
export const subscribe = (
    date: string,
    callback: (r: DailyRecord | null, hasPendingWrites: boolean) => void
): (() => void) => {
    if (isDemoModeActive()) {
        getDemoRecordForDate(date).then(r => callback(r, false));
        return () => { };
    }

    return subscribeToRecord(date, async (record, hasPendingWrites) => {
        const migrated = record ? migrateLegacyData(record, date) : null;
        if (migrated && !hasPendingWrites) {
            // Mirror to IndexedDB whenever we get an update from Firestore
            await saveToIndexedDB(migrated);
        }
        callback(migrated, hasPendingWrites);
    });
};

export const syncWithFirestore = async (date: string): Promise<DailyRecord | null> => {
    if (isDemoModeActive() || !isFirestoreEnabled()) return null;

    try {
        const record = await getRecordFromFirestore(date);
        if (record) {
            const migrated = migrateLegacyData(record, date);
            await saveToIndexedDB(migrated);
            return migrated;
        }

        // Fallback to legacy
        const legacyRecord = await getLegacyRecord(date);
        if (legacyRecord) {
            const migrated = migrateLegacyData(legacyRecord, date);
            await saveToIndexedDB(migrated);
            return migrated;
        }
    } catch (err) {
        console.warn(`[Repository] Sync failed for ${date}:`, err);
    }
    return null;
};

/**
 * Initializes a new daily record for the given date.
 */
export const initializeDay = async (
    date: string,
    copyFromDate?: string
): Promise<DailyRecord> => {
    // 1. Check if record already exists
    const existing = await getForDate(date);
    if (existing) return existing;

    if (!isDemoModeActive() && isFirestoreEnabled()) {
        try {
            const remoteRecord = await getRecordFromFirestore(date);
            if (remoteRecord) {
                // Critical: Migrating here ensures that checking for existing 
                // records during initialization also uses the latest schema
                const migrated = migrateLegacyData(remoteRecord, date);
                await saveToIndexedDB(migrated);
                return migrated;
            }

            // Falling back to legacy for initialization if possible
            const legacyRecord = await getLegacyRecord(date);
            if (legacyRecord) {
                const migrated = migrateLegacyData(legacyRecord, date);
                await saveToIndexedDB(migrated);
                return migrated;
            }
        } catch (err) {
            console.warn(`[Repository] Failed to check remote sources for ${date} during init:`, err);
        }
    }

    const initialBeds: Record<string, PatientData> = {};
    let activeExtras: string[] = [];
    let initialOverrides: Record<string, BedType> = {};

    BEDS.forEach(bed => {
        initialBeds[bed.id] = createEmptyPatient(bed.id);
    });

    let nursesDay: string[] = ["", ""];
    const nursesNight: string[] = ["", ""];
    let tensDay: string[] = ["", "", ""];
    const tensNight: string[] = ["", "", ""];

    // If a copyFromDate is provided, copy active patients and staff
    const prevRecord = copyFromDate ? await getForDate(copyFromDate) : null;

    if (prevRecord) {
        const prevBeds = prevRecord.beds;

        // Priority Migration: Use shift-based arrays, fallback to legacy 'nurses' if exists or if shift arrays are "empty" (defaults)
        const isNightShiftEmpty = !prevRecord.nursesNightShift || prevRecord.nursesNightShift.every(n => !n);
        const prevNurses = !isNightShiftEmpty ? prevRecord.nursesNightShift : (prevRecord.nurses || ["", ""]);

        // Ensure nursesDay is always length 2
        nursesDay = [...(prevNurses || ["", ""])];
        while (nursesDay.length < 2) nursesDay.push("");
        nursesDay = nursesDay.slice(0, 2);

        const isNightTensEmpty = !prevRecord.tensNightShift || prevRecord.tensNightShift.every(t => !t);
        const rawTens = !isNightTensEmpty ? prevRecord.tensNightShift! : (prevRecord.tensDayShift || ["", "", ""]);

        // Ensure tensDay is always length 3
        tensDay = [...rawTens];
        while (tensDay.length < 3) tensDay.push("");
        tensDay = tensDay.slice(0, 3);

        activeExtras = [...(prevRecord.activeExtraBeds || [])];
        initialOverrides = { ...(prevRecord.bedTypeOverrides || {}) };

        BEDS.forEach(bed => {
            const prevPatient = prevBeds[bed.id];
            if (prevPatient) {
                // Robust copy condition: Copy if patient has a name, is blocked OR has diagnosis data (CIE-10 or free text)
                // This prevents losing diagnosis data if the name was not yet entered.
                if (
                    prevPatient.patientName ||
                    prevPatient.isBlocked ||
                    prevPatient.cie10Code ||
                    prevPatient.cie10Description ||
                    prevPatient.pathology ||
                    prevPatient.diagnosisComments
                ) {
                    initialBeds[bed.id] = clonePatient(prevPatient);

                    // Reset CUDYR for the new day to ensure re-categorization
                    initialBeds[bed.id].cudyr = undefined;

                    // Reset CUDYR for nested clinical crib (baby) if present
                    if (initialBeds[bed.id].clinicalCrib) {
                        initialBeds[bed.id].clinicalCrib!.cudyr = undefined;
                    }

                    const prevNightNote = prevPatient.handoffNoteNightShift || prevPatient.handoffNote || '';
                    initialBeds[bed.id].handoffNoteDayShift = prevNightNote;
                    initialBeds[bed.id].handoffNoteNightShift = prevNightNote;

                    if (initialBeds[bed.id].clinicalCrib && prevPatient.clinicalCrib) {
                        const cribPrevNight = prevPatient.clinicalCrib.handoffNoteNightShift || prevPatient.clinicalCrib.handoffNote || '';
                        initialBeds[bed.id].clinicalCrib!.handoffNoteDayShift = cribPrevNight;
                        initialBeds[bed.id].clinicalCrib!.handoffNoteNightShift = cribPrevNight;
                    }
                } else {
                    initialBeds[bed.id].bedMode = prevPatient.bedMode || initialBeds[bed.id].bedMode;
                    initialBeds[bed.id].hasCompanionCrib = prevPatient.hasCompanionCrib || false;
                }
                if (prevPatient.location && bed.isExtra) {
                    initialBeds[bed.id].location = prevPatient.location;
                }
            }
        });
    }

    const dateObj = new Date(date + 'T00:00:00');
    const newRecord: DailyRecord = {
        date,
        beds: initialBeds,
        discharges: [],
        transfers: [],
        cma: [],
        bedTypeOverrides: initialOverrides,
        lastUpdated: new Date().toISOString(),
        dateTimestamp: dateObj.getTime(),
        nurses: ["", ""],
        nursesDayShift: nursesDay,
        nursesNightShift: nursesNight,
        tensDayShift: tensDay,
        tensNightShift: tensNight,
        activeExtraBeds: activeExtras,
        // Copy previous handoff novedades (Inter-day persistence)
        // Logic: Day starts with previous Night's notes, or fallback to Day notes if Night was just inherited
        handoffNovedadesDayShift: prevRecord
            ? (prevRecord.handoffNovedadesNightShift || prevRecord.handoffNovedadesDayShift || '')
            : ''
    };

    await save(newRecord);
    return newRecord;
};

/**
 * Deletes a daily record from both local and remote storage.
 */
export const deleteDay = async (date: string): Promise<void> => {
    if (isDemoModeActive()) {
        await deleteDemoRecord(date);
    } else {
        // 1. Local Delete (IndexedDB)
        await deleteFromIndexedDB(date);

        // 2. Soft Delete in Firestore (Move to trash)
        if (isFirestoreEnabled()) {
            try {
                const record = await getRecordFromFirestore(date);
                if (record) {
                    // Create a snapshot in the deletedRecords collection
                    // Note: This requires a new helper in firestoreService or direct access
                    // For now, I'll use saveRecordToFirestore with a custom path if possible, 
                    // or just implement moveRecordToTrash in firestoreService.
                    await moveRecordToTrash(record);
                }
                await deleteRecordFromFirestore(date);
            } catch (error) {
                console.error('Failed to soft-delete from Firestore:', error);
                // Fallback to hard delete if move fails? No, better to keep it and report error.
            }
        }
    }
};

/**
 * Copies a single patient from one date/bed to another.
 * Handles cloning and CUDYR reset.
 */
export const copyPatientToDate = async (
    sourceDate: string,
    sourceBedId: string,
    targetDate: string,
    targetBedId: string
): Promise<void> => {
    // 1. Get source record
    const sourceRecord = await getForDate(sourceDate);
    if (!sourceRecord) throw new Error(`Source record for ${sourceDate} not found`);

    const sourcePatient = sourceRecord.beds[sourceBedId];
    if (!sourcePatient || !sourcePatient.patientName) {
        throw new Error(`No patient found in bed ${sourceBedId} on ${sourceDate}`);
    }

    // 2. Get target record
    let targetRecord = await getForDate(targetDate);
    if (!targetRecord) {
        targetRecord = await initializeDay(targetDate);
    }

    // 3. Clone and modify patient
    const clonedPatient = clonePatient(sourcePatient);

    // Reset cross-day fields
    clonedPatient.cudyr = undefined;
    if (clonedPatient.clinicalCrib) {
        clonedPatient.clinicalCrib.cudyr = undefined;
    }

    // Shift handoff notes (Night -> Day for the same patient? 
    // Usually cross-date copy is for a "fresh" start on another day)
    const nightNote = sourcePatient.handoffNoteNightShift || sourcePatient.handoffNote || '';
    clonedPatient.handoffNoteDayShift = nightNote;
    clonedPatient.handoffNoteNightShift = nightNote;

    // 4. Update target record
    targetRecord.beds[targetBedId] = clonedPatient;
    targetRecord.lastUpdated = new Date().toISOString();

    // 5. Save
    await save(targetRecord);
};

// ============================================================================
// Repository Object Export (Alternative API)
// ============================================================================

export const DailyRecordRepository: IDailyRecordRepository & { syncWithFirestore: typeof syncWithFirestore } = {
    getForDate,
    getPreviousDay,
    save,
    subscribe,
    initializeDay,
    deleteDay,
    updatePartial,
    copyPatientToDate,
    syncWithFirestore,
    getAllDates: getAvailableDates
};
