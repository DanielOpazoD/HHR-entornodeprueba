/**
 * Daily Record Repository
 * Provides a unified interface for accessing and persisting daily records.
 * Abstracts localStorage and Firestore operations.
 * Supports demo mode with isolated storage.
 */

import { DailyRecord, PatientData } from '../../types';
import { DailyRecordPatchLoose } from '../../hooks/useDailyRecordTypes';
import { BEDS } from '../../constants';
import {
    getRecordForDate as getRecordFromIndexedDB,
    getPreviousDayRecord as getPreviousDayFromIndexedDB,
    saveRecord as saveToIndexedDB,
    deleteRecord as deleteFromIndexedDB,
    getAllRecords as getAllFromIndexedDB,
    getAllDates as getAllDatesFromIndexedDB,
    getAllDemoRecords as getAllDemoRecordsFromIndexedDB,
    migrateFromLocalStorage,
    isIndexedDBAvailable,
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
    saveNurseCatalogToFirestore,
    saveTensCatalogToFirestore,
    subscribeToNurseCatalog,
    subscribeToTensCatalog,
    moveRecordToTrash
} from '../storage/firestoreService';
import { CURRENT_SCHEMA_VERSION } from '../../constants/version';
import {
    getDailyRecordsPath,
    getActiveHospitalId
} from '../../constants/firestorePaths';
import { createEmptyPatient, clonePatient } from '../factories/patientFactory';
import { applyPatches } from '../../utils/patchUtils';
import { checkRegression, DataRegressionError, calculateDensity, VersionMismatchError } from '../../utils/integrityGuard';
import { parseDailyRecordWithDefaults } from '../../schemas/zodSchemas';
import { mapPatientToFhir, mapEncounterToFhir } from '../utils/fhirMappers';

// ============================================================================
// Configuration
// ============================================================================

let firestoreEnabled = true;
let demoModeActive = false;

export const setFirestoreEnabled = (enabled: boolean): void => {
    firestoreEnabled = enabled;
};

export const isFirestoreEnabled = (): boolean => firestoreEnabled;

export const setDemoModeActive = (active: boolean): void => {
    demoModeActive = active;
};

export const isDemoModeActive = (): boolean => demoModeActive;

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
}

// ============================================================================
// Repository Implementation
// ============================================================================

// Duplicate imports removed

/**
 * Migrates legacy data formats to the current schema using Zod for robust validation.
 */
const migrateLegacyData = (record: DailyRecord, date: string): DailyRecord => {
    // 1. Initial pass through Zod to apply defaults and recover basic structure
    let migrated = parseDailyRecordWithDefaults(record, date);

    // 2. Custom Business Migrations (Manual fixes for specific legacy rules)
    // Legacy Nurses: If nursesDayShift is empty but legacy 'nurses' has data, migrate it.
    if (migrated.nurses && migrated.nurses.length > 0) {
        if (!migrated.nursesDayShift || migrated.nursesDayShift.every(n => !n)) {
            migrated.nursesDayShift = [...migrated.nurses];
        }
    }

    // Legacy NurseName: Legacy single string migration
    if (migrated.nurseName && (!migrated.nursesDayShift || !migrated.nursesDayShift[0])) {
        if (!migrated.nursesDayShift) migrated.nursesDayShift = ["", ""];
        migrated.nursesDayShift[0] = migrated.nurseName;
    }

    // Ensure schemaVersion is at least 1
    migrated.schemaVersion = Math.max(migrated.schemaVersion || 0, 1);

    return migrated;
};

/**
 * Retrieves the daily record for a specific date.
 * First tries IndexedDB (fast), then syncs from Firestore if online and local is empty.
 * 
 * @param date - Date in YYYY-MM-DD format
 * @param syncFromRemote - If true, also check Firestore when local is empty
 * @returns The daily record if it exists, null otherwise
 */
export const getForDate = async (date: string, syncFromRemote: boolean = true): Promise<DailyRecord | null> => {
    if (demoModeActive) {
        return await getDemoRecordForDate(date);
    }

    // 1. Try local first (fast)
    const localRecord = await getRecordFromIndexedDB(date);

    // 2. If no local record and sync is enabled, try Firestore
    if (!localRecord && syncFromRemote && firestoreEnabled) {
        try {
            const remoteRecord = await getRecordFromFirestore(date);
            if (remoteRecord) {
                const migrated = migrateLegacyData(remoteRecord, date);
                // Cache it locally for next time
                await saveToIndexedDB(migrated);
                return migrated;
            }
        } catch (err) {
            console.warn(`[Repository] getForDate: Firestore fallback failed for ${date}:`, err);
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
    if (demoModeActive) {
        return await getPreviousDemoDayRecord(date);
    }
    return getPreviousDayFromIndexedDB(date);
};

/**
 * Retrieves all dates that have patient records.
 * Used for the "copy from any day" feature.
 * 
 * @returns Array of date strings (YYYY-MM-DD) sorted descending (most recent first)
 */
export const getAvailableDates = async (): Promise<string[]> => {
    if (demoModeActive) {
        const records = await getAllDemoRecordsFromIndexedDB();
        return Object.keys(records).sort().reverse();
    }
    return getAllDatesFromIndexedDB();
};

/**
 * Saves a daily record to storage.
 * 
 * @param record - The daily record to save
 */
export const save = async (record: DailyRecord, expectedLastUpdated?: string): Promise<void> => {
    if (demoModeActive) {
        await saveDemoRecord(record);
        return;
    }

    // 0. Defense-in-depth: Validate structure before persisting
    const validatedRecord = migrateLegacyData(record, record.date);

    // Use validated record from here on
    const currentRecord = validatedRecord;

    // Ensure dateTimestamp is present for security rules (legacy records fix)
    if (!currentRecord.dateTimestamp && currentRecord.date) {
        const dateObj = new Date(currentRecord.date + 'T00:00:00');
        currentRecord.dateTimestamp = dateObj.getTime();
    }

    // FHIR Enrichment Layer (Dual Mode)
    const hospitalId = getActiveHospitalId();
    Object.keys(currentRecord.beds).forEach(bedId => {
        const patient = currentRecord.beds[bedId];
        if (patient && patient.patientName && patient.patientName.trim()) {
            // Self-contained enrichment: generate FHIR Resource
            patient.fhir_resource = mapPatientToFhir(patient);

            // Nested Patient (Clinical Crib) enrichment
            if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
                patient.clinicalCrib.fhir_resource = mapPatientToFhir(patient.clinicalCrib);
            }
        }
    });

    // 1. Check for suspicious regressions BEFORE saving to IndexedDB OR Firestore
    // This protects against overwriting good cloud data with empty local data (sync failure scenario)
    if (firestoreEnabled) {
        try {
            const remoteRecord = await getRecordFromFirestore(record.date);
            if (remoteRecord) {
                // A. Version Check (Schema Guard)
                const remoteVersion = remoteRecord.schemaVersion || 0;
                if (remoteVersion > CURRENT_SCHEMA_VERSION) {
                    console.error(`[Versioning] Blocked save. Local: ${CURRENT_SCHEMA_VERSION}, Cloud: ${remoteVersion}`);
                    throw new VersionMismatchError(
                        `Tu aplicación está desactualizada (v${CURRENT_SCHEMA_VERSION}) y el registro en la nube usa el nuevo formato v${remoteVersion}. Por favor, recarga la página para actualizar.`
                    );
                }

                // B. Data Integrity Check (Regression Guard)
                const { isSuspicious, dropPercentage } = checkRegression(remoteRecord, record);
                if (isSuspicious) {
                    console.warn(`[Repository] BLOCKING SAVE: Suspicious regression detected (${dropPercentage.toFixed(1)}% drop)`);
                    throw new DataRegressionError(
                        `Se detectó una pérdida masiva de datos (${dropPercentage.toFixed(1)}%). El guardado fue bloqueado para proteger la información en la nube.`,
                        calculateDensity(record),
                        calculateDensity(remoteRecord)
                    );
                }
            }
        } catch (err) {
            // Rethrow specialized errors
            if (err instanceof DataRegressionError || err instanceof VersionMismatchError) throw err;
            // Suppress network errors for the check itself (if we can't check, we proceed optimistically)
            console.warn('[Repository] Could not perform integrity check, proceeding:', err);
        }
    }

    // Always set current version before saving
    currentRecord.schemaVersion = CURRENT_SCHEMA_VERSION;

    // Save to IndexedDB (unlimited capacity)
    await saveToIndexedDB(currentRecord);

    // Sync to Firestore in background (if enabled)
    if (firestoreEnabled) {
        try {
            await saveRecordToFirestore(currentRecord, expectedLastUpdated);
        } catch (err) {
            console.warn('Firestore sync failed, data saved in IndexedDB:', err);
            // If it's a ConcurrencyError or DataRegressionError, we SHOULD rethrow it to notify the user
            if (err && ((err as Error).name === 'ConcurrencyError' || err instanceof DataRegressionError)) {
                throw err;
            }
        }
    }
};

/**
 * Updates specific fields of a daily record without overwriting the entire document.
 */
export const updatePartial = async (date: string, partialData: DailyRecordPatchLoose): Promise<void> => {
    console.log('[Repository] updatePartial called:', date, Object.keys(partialData));

    // Update local storage (IndexedDB)
    if (demoModeActive) {
        const current = await getDemoRecordForDate(date);
        if (current) {
            const updated = applyPatches(current, partialData);
            updated.lastUpdated = new Date().toISOString();
            await saveDemoRecord(updated);
        }
    } else {
        const current = await getRecordFromIndexedDB(date);
        if (current) {
            const updated = applyPatches(current, partialData);
            updated.lastUpdated = new Date().toISOString();
            await saveToIndexedDB(updated);
        }
    }

    // 2. Update Firestore
    if (!demoModeActive) {
        try {
            console.log('[Repository] Sending partial update to Firestore:', date);

            // Determine if FHIR resource needs regeneration
            // If any patient field in any bed is changed, we should ideally update its fhir_resource.
            // However, since we don't have the full patient data here, we have two options:
            // 1. Just let it be (it will be updated on the next full save)
            // 2. Or, if the patch contains 'patientName' or 'rut', we should consider it a major change.

            // For now, let's enhance the patch if we are in updatePartial by recalculating FHIR 
            // ONLY if the full record is available locally.
            const current = await getRecordFromIndexedDB(date);
            if (current) {
                const updated = applyPatches(current, partialData);

                // Re-run FHIR enrichment on affected beds
                Object.keys(partialData).forEach(key => {
                    if (key.startsWith('beds.')) {
                        const parts = key.split('.');
                        const bedId = parts[1];
                        const patient = updated.beds[bedId];
                        if (patient && patient.patientName) {
                            patient.fhir_resource = mapPatientToFhir(patient);
                            // Add the fhir_resource update to the original patch
                            (partialData as any)[`beds.${bedId}.fhir_resource`] = patient.fhir_resource;
                        }
                    }
                });
            }

            await updateRecordPartial(date, partialData);
        } catch (err) {
            console.warn('Firestore partial update failed:', err);
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
    if (demoModeActive) {
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

/**
 * Manually pulls the latest data from Firestore and updates local storage.
 */
export const syncWithFirestore = async (date: string): Promise<DailyRecord | null> => {
    if (demoModeActive || !firestoreEnabled) return null;

    try {
        const record = await getRecordFromFirestore(date);
        if (record) {
            const migrated = migrateLegacyData(record, date);
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

    if (!demoModeActive && firestoreEnabled) {
        try {
            const remoteRecord = await getRecordFromFirestore(date);
            if (remoteRecord) {
                await saveToIndexedDB(remoteRecord);
                return remoteRecord;
            }
        } catch (err) {
            console.warn(`[Repository] Failed to check Firestore for ${date} during init:`, err);
        }
    }

    let initialBeds: Record<string, PatientData> = {};
    let activeExtras: string[] = [];

    BEDS.forEach(bed => {
        initialBeds[bed.id] = createEmptyPatient(bed.id);
    });

    let nursesDay: string[] = ["", ""];
    let nursesNight: string[] = ["", ""];
    let tensDay: string[] = ["", "", ""];
    let tensNight: string[] = ["", "", ""];

    // If a copyFromDate is provided, copy active patients and staff
    const prevRecord = copyFromDate ? await getForDate(copyFromDate) : null;

    if (prevRecord) {
        const prevBeds = prevRecord.beds;

        // Priority Migration: Use shift-based arrays, fallback to legacy 'nurses' if exists
        const prevNurses = prevRecord.nursesNightShift || prevRecord.nurses || ["", ""];
        nursesDay = [...prevNurses];

        tensDay = [...(prevRecord.tensNightShift || prevRecord.tensDayShift || ["", "", ""])];
        activeExtras = [...(prevRecord.activeExtraBeds || [])];

        BEDS.forEach(bed => {
            const prevPatient = prevBeds[bed.id];
            if (prevPatient) {
                if (prevPatient.patientName || prevPatient.isBlocked) {
                    initialBeds[bed.id] = clonePatient(prevPatient);
                    initialBeds[bed.id].cudyr = undefined;
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
    if (demoModeActive) {
        await deleteDemoRecord(date);
    } else {
        // 1. Local Delete (IndexedDB)
        await deleteFromIndexedDB(date);

        // 2. Soft Delete in Firestore (Move to trash)
        if (firestoreEnabled) {
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
 * Result of month integrity check
 */
export interface MonthIntegrityResult {
    success: boolean;
    initializedDays: string[];
    errors: string[];
    totalDays: number;
}

/**
 * Ensures all days of a month up to a specified day are initialized.
 */
export const ensureMonthIntegrity = async (
    year: number,
    month: number,
    upToDay: number
): Promise<MonthIntegrityResult> => {
    const initializedDays: string[] = [];
    const errors: string[] = [];

    for (let day = 1; day <= upToDay; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const existing = await getForDate(dateStr);

        if (!existing) {
            try {
                const prevDateStr = day > 1
                    ? `${year}-${String(month).padStart(2, '0')}-${String(day - 1).padStart(2, '0')}`
                    : undefined;

                await initializeDay(dateStr, prevDateStr);
                initializedDays.push(dateStr);
            } catch (error) {
                errors.push(dateStr);
            }
        }
    }

    return {
        success: errors.length === 0,
        initializedDays,
        errors,
        totalDays: upToDay
    };
};

// ============================================================================
// Catalog Operations (Nurses, TENS)
// ============================================================================

import {
    saveCatalog,
    getCatalog
} from '../storage/indexedDBService';

export const getNurses = async (): Promise<string[]> => {
    const list = await getCatalog('nurses');
    return list.length > 0 ? list : ["Enfermero/a 1", "Enfermero/a 2"];
};

export const saveNurses = async (nurses: string[]): Promise<void> => {
    await saveCatalog('nurses', nurses);
    if (firestoreEnabled && !demoModeActive) {
        await saveNurseCatalogToFirestore(nurses);
    }
};

export const subscribeNurses = (callback: (nurses: string[]) => void): (() => void) => {
    if (demoModeActive) return () => { };
    return subscribeToNurseCatalog(async (nurses) => {
        await saveCatalog('nurses', nurses);
        callback(nurses);
    });
};

export const getTens = async (): Promise<string[]> => {
    return getCatalog('tens');
};

export const saveTens = async (tens: string[]): Promise<void> => {
    await saveCatalog('tens', tens);
    if (firestoreEnabled && !demoModeActive) {
        await saveTensCatalogToFirestore(tens);
    }
};

export const subscribeTens = (callback: (tens: string[]) => void): (() => void) => {
    if (demoModeActive) return () => { };
    return subscribeToTensCatalog(async (tens) => {
        await saveCatalog('tens', tens);
        callback(tens);
    });
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
    syncWithFirestore,
    getAllDates: getAllDatesFromIndexedDB
};

export const CatalogRepository = {
    getNurses,
    saveNurses,
    subscribeNurses,
    getTens,
    saveTens,
    subscribeTens
};
