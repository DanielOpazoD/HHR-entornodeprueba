import { db } from '@/firebaseConfig';
import { doc, getDoc, setDoc, writeBatch, collection, query, orderBy, limit, startAfter, getDocs, where, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { MasterPatient } from '@/types';
import { formatRut, isValidRut } from '@/utils/rutUtils';
import { getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';

const COLLECTION_NAME = HOSPITAL_COLLECTIONS.PATIENTS;

/**
 * Normalizes RUT for use as Document ID
 * Ensures consistent format (12.345.678-9) or clean format (12345678-9)
 * We chose formatted RUT for readability in Console
 */
const normalizeId = (rut: string): string => {
    return formatRut(rut).toUpperCase();
};

const getCollectionPath = (): string => {
    const hospitalId = getActiveHospitalId();
    return `hospitals/${hospitalId}/${COLLECTION_NAME}`;
};

/**
 * Retrieves a patient from the master index by RUT
 */
export const getPatientByRut = async (rut: string): Promise<MasterPatient | null> => {
    if (!rut || !isValidRut(rut)) return null;

    const id = normalizeId(rut);
    const path = getCollectionPath();
    const docRef = doc(db, path, id);

    try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            return snap.data() as MasterPatient;
        }
    } catch (err) {
        console.error('[PatientMasterRepository] Error fetching patient:', err);
    }
    return null;
};

/**
 * Creates or updates a patient in the master index
 * Uses merge: true to preserve existing fields not present in partial update
 */
export const upsertPatient = async (patient: Partial<MasterPatient> & { rut: string }): Promise<void> => {
    if (!patient.rut || !isValidRut(patient.rut)) {
        console.warn('[PatientMasterRepository] Invalid RUT for upsert:', patient.rut);
        return;
    }

    const id = normalizeId(patient.rut);
    const path = getCollectionPath();
    const docRef = doc(db, path, id);

    const now = Date.now();

    const dataToSave: Partial<MasterPatient> & { updatedAt: number } = {
        ...patient,
        rut: id, // Ensure ID format matches field
        updatedAt: now
    };

    // If creating new, set createdAt (using serverTimestamp for consistency or local if preferred)
    // Since merge doesn't support "set only if new" mixed with update easily, we rely on existing check or just overwrite
    // But to keep createdAt stable, we might need check. 
    // Optimization: Just set updatedAt. If we want createdAt, we can use a simpler approach:
    // If it's a migration, use provided createdAt.

    if (!patient.createdAt) {
        // We don't overwrite createdAt if it exists, but setDoc merge doesn't do "setOnInsert".
        // Use Javascript logical merge if needed, but for now assuming client doesn't care much about precise creation time of index record
        // or we check existence. checking existence is extra cost.
        // Let's just set updatedAt.
    }

    try {
        await setDoc(docRef, dataToSave, { merge: true });
    } catch (err) {
        console.error('[PatientMasterRepository] Error upserting patient:', err);
    }
};

/**
 * Batch imports patients for migration tools
 */
export const bulkUpsertPatients = async (patients: MasterPatient[]): Promise<{ successes: number, errors: number }> => {
    const path = getCollectionPath();
    const batchSize = 400; // Limit is 500
    let successes = 0;
    let errors = 0;

    for (let i = 0; i < patients.length; i += batchSize) {
        const chunk = patients.slice(i, i + batchSize);
        const batch = writeBatch(db);

        chunk.forEach(p => {
            const id = normalizeId(p.rut);
            const docRef = doc(db, path, id);
            batch.set(docRef, p, { merge: true });
        });

        try {
            await batch.commit();
            successes += chunk.length;
        } catch (err) {
            console.error('[PatientMasterRepository] Batch commit failed:', err);
            errors += chunk.length;
        }
    }

    return { successes, errors };
};

/**
 * Retrieves all patients from the master index (Limited to 1000 for safety)
 */
export const getAllPatients = async (): Promise<MasterPatient[]> => {
    const path = getCollectionPath();
    try {
        const q = query(collection(db, path), orderBy('updatedAt', 'desc'), limit(1000));
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data() as MasterPatient);
    } catch (err) {
        console.error('[PatientMasterRepository] Error fetching all patients:', err);
        return [];
    }
};

/**
 * Retrieves a paginated list of patients
 */
export const getPatientsPaginated = async (
    limitCount: number = 20,
    lastDoc?: QueryDocumentSnapshot<DocumentData>
): Promise<{ patients: MasterPatient[], lastDoc: QueryDocumentSnapshot<DocumentData> | null }> => {
    const path = getCollectionPath();
    try {
        let q = query(collection(db, path), orderBy('updatedAt', 'desc'), limit(limitCount));

        if (lastDoc) {
            q = query(q, startAfter(lastDoc));
        }

        const snap = await getDocs(q);
        const patients = snap.docs.map(d => d.data() as MasterPatient);
        const last = snap.docs[snap.docs.length - 1] || null;

        return { patients, lastDoc: last };
    } catch (err) {
        console.error('[PatientMasterRepository] Error fetching paginated patients:', err);
        return { patients: [], lastDoc: null };
    }
};

/**
 * Searches for patients by RUT or Name (limited results)
 */
export const searchPatients = async (searchTerm: string, limitCount: number = 20): Promise<MasterPatient[]> => {
    if (!searchTerm || searchTerm.length < 2) return [];

    const path = getCollectionPath();
    try {
        // 1. Try Exact match by RUT first
        if (isValidRut(searchTerm)) {
            const patient = await getPatientByRut(searchTerm);
            if (patient) return [patient];
        }

        // 2. Try simple search by Full Name (requires indexing in Firestore)
        // Since Firestore doesn't support partial text matches without third party tools,
        // we use a prefix search if possible, or just fetch more and filter.
        // For the hospital context, we'll use a prefix query on fullName.
        const q = query(
            collection(db, path),
            orderBy('fullName'),
            where('fullName', '>=', searchTerm),
            where('fullName', '<=', searchTerm + '\uf8ff'),
            limit(limitCount)
        );

        const snap = await getDocs(q);
        return snap.docs.map(d => d.data() as MasterPatient);
    } catch (err) {
        console.error('[PatientMasterRepository] Error searching patients:', err);
        return [];
    }
};

/**
 * Migration Utility: Scans ALL daily records and populates the Master Index.
 * Intended to be run once to backfill historical data.
 */
export const migrateFromDailyRecords = async (): Promise<{ scannedDays: number, totalPatients: number }> => {
    // Dynamic import to avoid circular dependency
    const { DailyRecordRepository } = await import('./DailyRecordRepository');

    const dates = await DailyRecordRepository.getAllDates();
    const uniquePatients = new Map<string, MasterPatient>();

    for (const date of dates) {
        const record = await DailyRecordRepository.getForDate(date);
        if (!record || !record.beds) continue;

        // Process main beds
        Object.values(record.beds).forEach(patient => {
            if (patient.patientName?.trim() && patient.rut?.trim() && isValidRut(patient.rut)) {
                const id = normalizeId(patient.rut);
                // Last write wins (later dates overwrite earlier ones if we process in order)
                // Actually getAllDates returns desc order usually, or we assume.
                // We just want to capture ANY valid data.
                if (!uniquePatients.has(id)) {
                    uniquePatients.set(id, {
                        rut: id,
                        fullName: patient.patientName,
                        birthDate: patient.birthDate,
                        forecast: patient.insurance,
                        gender: patient.biologicalSex,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                }
            }

            // Process Clinical Cribs
            if (patient.clinicalCrib?.patientName?.trim() && patient.clinicalCrib?.rut?.trim() && isValidRut(patient.clinicalCrib.rut)) {
                const id = normalizeId(patient.clinicalCrib.rut);
                if (!uniquePatients.has(id)) {
                    uniquePatients.set(id, {
                        rut: id,
                        fullName: patient.clinicalCrib.patientName,
                        birthDate: patient.clinicalCrib.birthDate,
                        forecast: patient.insurance, // Baby usually shares insurance or N/A
                        gender: patient.clinicalCrib.biologicalSex,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                }
            }
        });
    }

    const patientsList = Array.from(uniquePatients.values());
    if (patientsList.length > 0) {
        console.warn(`[Migration] Found ${patientsList.length} unique patients across ${dates.length} days. Syncing...`);
        await bulkUpsertPatients(patientsList);
    }

    return { scannedDays: dates.length, totalPatients: patientsList.length };
};

export const PatientMasterRepository = {
    getPatientByRut,
    upsertPatient,
    bulkUpsertPatients,
    getAllPatients,
    getPatientsPaginated,
    searchPatients
};
