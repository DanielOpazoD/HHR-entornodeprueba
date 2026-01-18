import { db } from '../../firebaseConfig';
import { doc, getDoc, setDoc, writeBatch, serverTimestamp, collection, Timestamp } from 'firebase/firestore';
import { MasterPatient } from '../../types';
import { formatRut, isValidRut } from '../../utils/rutUtils';
import { getActiveHospitalId, HOSPITAL_COLLECTIONS, COLLECTIONS } from '../../constants/firestorePaths';

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

    const dataToSave: any = {
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
 * Retrieves all patients from the master index
 */
export const getAllPatients = async (): Promise<MasterPatient[]> => {
    const path = getCollectionPath();
    try {
        const { getDocs, query, orderBy, collection } = await import('firebase/firestore');
        const q = query(collection(db, path), orderBy('updatedAt', 'desc'));
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data() as MasterPatient);
    } catch (err) {
        console.error('[PatientMasterRepository] Error fetching all patients:', err);
        return [];
    }
};

export const PatientMasterRepository = {
    getPatientByRut,
    upsertPatient,
    bulkUpsertPatients,
    getAllPatients
};
