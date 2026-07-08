/**
 * Prescription Repository
 *
 * Read + admin-write surface for the prescriptions backup collection.
 * **Uploads** never go through this repository — they are mediated by the
 * `submitPrescriptionPhoto` Cloud Function so PIN-flow callers (anonymous)
 * can also write through a single audited path. This repository covers
 * the visor (list, get), patient re-assignment, and admin manual delete.
 */

import { firestoreDb } from '@/services/storage/firestore';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { getPrescriptionsCollectionPath } from '@/constants/prescriptionPaths';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { safeParsePrescriptionRecord } from '@/schemas/prescriptionSchemas';
import type {
  PrescriptionAssignmentScope,
  PrescriptionRecord,
  PrescriptionType,
} from '@/types/prescriptionTypes';

const sortByCreatedAtDesc = (records: PrescriptionRecord[]): PrescriptionRecord[] =>
  [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

const validateReadRecord = (record: PrescriptionRecord): PrescriptionRecord | null => {
  const parsed = safeParsePrescriptionRecord(record);
  if (!parsed) {
    recordOperationalTelemetry({
      category: 'prescription',
      status: 'failed',
      operation: 'prescription_repository_invalid_read_record',
      issues: ['Schema validation failed for prescription record'],
      context: { documentId: record?.id },
    });
    return null;
  }
  return parsed;
};

export const PrescriptionRepository = {
  async list(hospitalId: string = getActiveHospitalId()): Promise<PrescriptionRecord[]> {
    if (!isFirestoreEnabled()) return [];

    const documents = await firestoreDb.getDocs<PrescriptionRecord>(
      getPrescriptionsCollectionPath(hospitalId),
      { orderBy: [{ field: 'createdAt', direction: 'desc' }] }
    );

    return sortByCreatedAtDesc(
      documents
        .map(record => validateReadRecord(record))
        .filter((record): record is PrescriptionRecord => Boolean(record))
    );
  },

  async listByDateRange(
    fromIsoDate: string,
    toIsoDate: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<PrescriptionRecord[]> {
    if (!isFirestoreEnabled()) return [];

    const documents = await firestoreDb.getDocs<PrescriptionRecord>(
      getPrescriptionsCollectionPath(hospitalId),
      {
        where: [
          { field: 'createdAt', operator: '>=', value: fromIsoDate },
          { field: 'createdAt', operator: '<=', value: toIsoDate },
        ],
        orderBy: [{ field: 'createdAt', direction: 'desc' }],
      }
    );

    return sortByCreatedAtDesc(
      documents
        .map(record => validateReadRecord(record))
        .filter((record): record is PrescriptionRecord => Boolean(record))
    );
  },

  async get(
    prescriptionId: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<PrescriptionRecord | null> {
    if (!isFirestoreEnabled()) return null;

    const document = await firestoreDb.getDoc<PrescriptionRecord>(
      getPrescriptionsCollectionPath(hospitalId),
      prescriptionId
    );
    return document ? validateReadRecord(document) : null;
  },

  async reassignPatient(
    prescriptionId: string,
    patch: {
      bedId?: string;
      patientName?: string;
      patientRut?: string;
      assignmentScope?: PrescriptionAssignmentScope;
      reassignedBy: string;
      reassignedAt: string;
    },
    hospitalId: string = getActiveHospitalId()
  ): Promise<PrescriptionRecord> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore is not enabled — cannot reassign prescription patient.');
    }

    await firestoreDb.updateDoc(getPrescriptionsCollectionPath(hospitalId), prescriptionId, {
      bedId: patch.bedId ?? null,
      patientName: patch.patientName ?? null,
      patientRut: patch.patientRut ?? null,
      assignmentScope:
        patch.assignmentScope ??
        (patch.bedId || patch.patientName || patch.patientRut ? 'patient' : 'unassigned'),
      patientReassignedAt: patch.reassignedAt,
      patientReassignedBy: patch.reassignedBy,
    });

    const next = await this.get(prescriptionId, hospitalId);
    if (!next) {
      throw new Error(`Prescription ${prescriptionId} disappeared after re-assigning patient.`);
    }
    return next;
  },

  async updateType(
    prescriptionId: string,
    patch: {
      prescriptionType: PrescriptionType;
      updatedBy: string;
      updatedAt: string;
    },
    hospitalId: string = getActiveHospitalId()
  ): Promise<PrescriptionRecord> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore is not enabled — cannot update prescription type.');
    }

    await firestoreDb.updateDoc(getPrescriptionsCollectionPath(hospitalId), prescriptionId, {
      prescriptionType: patch.prescriptionType,
      typeUpdatedAt: patch.updatedAt,
      typeUpdatedBy: patch.updatedBy,
    });

    const next = await this.get(prescriptionId, hospitalId);
    if (!next) {
      throw new Error(`Prescription ${prescriptionId} disappeared after updating type.`);
    }
    return next;
  },

  async delete(prescriptionId: string, hospitalId: string = getActiveHospitalId()): Promise<void> {
    if (!isFirestoreEnabled()) return;
    await firestoreDb.deleteDoc(getPrescriptionsCollectionPath(hospitalId), prescriptionId);
  },

  subscribeToList(
    callback: (records: PrescriptionRecord[]) => void,
    hospitalId: string = getActiveHospitalId()
  ): () => void {
    if (!isFirestoreEnabled()) {
      callback([]);
      return () => {};
    }

    return firestoreDb.subscribeQuery<PrescriptionRecord>(
      getPrescriptionsCollectionPath(hospitalId),
      { orderBy: [{ field: 'createdAt', direction: 'desc' }] },
      records =>
        callback(
          sortByCreatedAtDesc(
            records
              .map(record => validateReadRecord(record))
              .filter((record): record is PrescriptionRecord => Boolean(record))
          )
        )
    );
  },
};
