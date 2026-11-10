import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  where,
  arrayUnion,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import type { MasterPatient } from '@/types/domain/patientMaster';
import { getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import {
  createBulkUpsertPatientsCommand,
  createUpsertPatientCommand,
  normalizeMasterPatientRut,
  normalizePatientSearchTerm,
  patientMatchesSearchTokens,
  sanitizePatientQueryLimit,
  tokenizePatientSearchTerm,
} from '@/services/repositories/contracts/patientMasterContracts';
import { defaultRepositoryFirestoreRuntime } from '@/services/repositories/repositoryFirestoreRuntime';
import type { RepositoryFirestoreRuntimePort } from '@/services/repositories/ports/repositoryFirestoreRuntimePort';
import { patientMasterRepositoryLogger } from '@/services/repositories/repositoryLoggers';

const COLLECTION_NAME = HOSPITAL_COLLECTIONS.PATIENTS;

/**
 * Normalizes RUT for use as Document ID
 * Ensures consistent format (12.345.678-9) or clean format (12345678-9)
 * We chose formatted RUT for readability in Console
 */
const getCollectionPath = (): string => {
  const hospitalId = getActiveHospitalId();
  return `hospitals/${hospitalId}/${COLLECTION_NAME}`;
};

export const createPatientMasterRepository = (
  runtime: RepositoryFirestoreRuntimePort = defaultRepositoryFirestoreRuntime
) => {
  const getDb = () => runtime.getDb();

  const getPatientByRut = async (rut: string): Promise<MasterPatient | null> => {
    const normalizedRut = normalizeMasterPatientRut(rut);
    if (!normalizedRut) return null;

    const path = getCollectionPath();
    const docRef = doc(getDb(), path, normalizedRut);

    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as MasterPatient;
      }
    } catch (err) {
      patientMasterRepositoryLogger.error(`Error fetching patient ${normalizedRut}`, err);
      throw err;
    }
    return null;
  };

  const upsertPatient = async (
    patient: Partial<MasterPatient> & { rut: string }
  ): Promise<void> => {
    const command = createUpsertPatientCommand(patient);
    if (!command) {
      patientMasterRepositoryLogger.warn(`Invalid RUT for upsert: ${patient.rut}`);
      return;
    }

    const path = getCollectionPath();
    const docRef = doc(getDb(), path, command.rut);

    const dataToSave: Partial<MasterPatient> & { updatedAt: number } = {
      ...command,
      rut: command.rut,
      updatedAt: Date.now(),
    };

    try {
      await setDoc(docRef, dataToSave, { merge: true });
    } catch (err) {
      patientMasterRepositoryLogger.error(`Error upserting patient ${command.rut}`, err);
    }
  };

  const bulkUpsertPatients = async (
    patients: MasterPatient[]
  ): Promise<{ successes: number; errors: number }> => {
    const normalizedPatients = createBulkUpsertPatientsCommand(patients);
    const path = getCollectionPath();
    const batchSize = 400;
    let successes = 0;
    let errors = patients.length - normalizedPatients.length;

    for (let i = 0; i < normalizedPatients.length; i += batchSize) {
      const chunk = normalizedPatients.slice(i, i + batchSize);
      const batch = writeBatch(getDb());

      chunk.forEach(patient => {
        const docRef = doc(getDb(), path, patient.rut);
        batch.set(docRef, { ...patient, rut: patient.rut }, { merge: true });
      });

      try {
        await batch.commit();
        successes += chunk.length;
      } catch (err) {
        patientMasterRepositoryLogger.error('Patient batch commit failed', err);
        errors += chunk.length;
      }
    }

    return { successes, errors };
  };

  const getAllPatients = async (): Promise<MasterPatient[]> => {
    const collected: MasterPatient[] = [];
    const pageSize = 250;
    let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

    try {
      while (true) {
        const page = await getPatientsPaginated(pageSize, lastDoc ?? undefined);
        collected.push(...page.patients);

        if (!page.lastDoc || page.patients.length < pageSize) {
          break;
        }

        lastDoc = page.lastDoc;
      }

      return collected;
    } catch (err) {
      patientMasterRepositoryLogger.error('Error fetching all patients', err);
      return [];
    }
  };

  const getPatientsPaginated = async (
    limitCount: number = 20,
    lastDoc?: QueryDocumentSnapshot<DocumentData>
  ): Promise<{
    patients: MasterPatient[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  }> => {
    const safeLimit = sanitizePatientQueryLimit(limitCount);
    const path = getCollectionPath();
    try {
      let q = query(collection(getDb(), path), orderBy('updatedAt', 'desc'), limit(safeLimit));

      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }

      const snap = await getDocs(q);
      return {
        patients: snap.docs.map(snapshot => snapshot.data() as MasterPatient),
        lastDoc: snap.docs[snap.docs.length - 1] || null,
      };
    } catch (err) {
      patientMasterRepositoryLogger.error('Error fetching paginated patients', err);
      return { patients: [], lastDoc: null };
    }
  };

  const searchPatients = async (
    searchTerm: string,
    limitCount: number = 20
  ): Promise<MasterPatient[]> => {
    const normalizedTerm = normalizePatientSearchTerm(searchTerm);
    const searchTokens = tokenizePatientSearchTerm(searchTerm);
    const safeLimit = sanitizePatientQueryLimit(limitCount);
    if (!normalizedTerm || searchTokens.length === 0) return [];

    const path = getCollectionPath();
    try {
      // The read by RUT is a shortcut. If it fails, the search below can still find the patient.
      const patient = await getPatientByRut(normalizedTerm).catch(() => null);
      if (patient) {
        return [patient];
      }

      if (searchTokens.length === 1) {
        const q = query(
          collection(getDb(), path),
          orderBy('fullName'),
          where('fullName', '>=', normalizedTerm),
          where('fullName', '<=', normalizedTerm + '\uf8ff'),
          limit(safeLimit)
        );

        const snap = await getDocs(q);
        const prefixMatches = snap.docs
          .map(snapshot => snapshot.data() as MasterPatient)
          .filter(patientEntry => patientMatchesSearchTokens(patientEntry, searchTokens));

        if (prefixMatches.length > 0) {
          return prefixMatches;
        }
      }

      const allPatients = await getAllPatients();
      return allPatients
        .filter(patientEntry => patientMatchesSearchTokens(patientEntry, searchTokens))
        .sort((left, right) =>
          left.fullName.localeCompare(right.fullName, 'es', { sensitivity: 'base' })
        )
        .slice(0, safeLimit);
    } catch (err) {
      patientMasterRepositoryLogger.error(`Error searching patients for "${normalizedTerm}"`, err);
      return [];
    }
  };

  /**
   * Appends a hospitalization event to a patient's `hospitalizations` array
   * using Firestore `arrayUnion` (no duplicates, no overwrite).
   *
   * Also upserts basic patient data if the document doesn't exist yet,
   * so patients appearing only in discharges/transfers are indexed.
   */
  const appendHospitalizationEvent = async (
    patient: {
      rut: string;
      fullName: string;
      birthDate?: string;
      forecast?: string;
      gender?: string;
    },
    event: import('@/types/domain/patientMaster').HospitalizationEvent,
    extra?: {
      lastAdmission?: string;
      lastDischarge?: string;
      vitalStatus?: 'Vivo' | 'Fallecido';
    }
  ): Promise<void> => {
    const command = createUpsertPatientCommand({ rut: patient.rut, fullName: patient.fullName });
    if (!command) return;

    const path = getCollectionPath();
    const docRef = doc(getDb(), path, command.rut);

    try {
      // Ensure the document exists with basic data first
      await setDoc(
        docRef,
        {
          rut: command.rut,
          fullName: command.fullName,
          ...(patient.birthDate ? { birthDate: patient.birthDate } : {}),
          ...(patient.forecast ? { forecast: patient.forecast } : {}),
          ...(patient.gender ? { gender: patient.gender } : {}),
          ...(extra?.lastAdmission ? { lastAdmission: extra.lastAdmission } : {}),
          ...(extra?.lastDischarge ? { lastDischarge: extra.lastDischarge } : {}),
          ...(extra?.vitalStatus ? { vitalStatus: extra.vitalStatus } : {}),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      // Append the event atomically (arrayUnion prevents duplicates)
      await updateDoc(docRef, {
        hospitalizations: arrayUnion(event),
      });
    } catch (err) {
      patientMasterRepositoryLogger.error(
        `Error appending hospitalization event for ${command.rut}`,
        err
      );
    }
  };

  return {
    getPatientByRut,
    upsertPatient,
    appendHospitalizationEvent,
    bulkUpsertPatients,
    getAllPatients,
    getPatientsPaginated,
    searchPatients,
  };
};

export const PatientMasterRepository = createPatientMasterRepository();
export const {
  getPatientByRut,
  upsertPatient,
  appendHospitalizationEvent,
  bulkUpsertPatients,
  getAllPatients,
  getPatientsPaginated,
  searchPatients,
} = PatientMasterRepository;
