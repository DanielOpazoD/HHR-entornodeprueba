import { PrescriptionRepository } from '@/services/repositories/PrescriptionRepository';
import type {
  PrescriptionAssignmentScope,
  PrescriptionRecord,
  PrescriptionType,
} from '@/types/prescriptionTypes';

/**
 * Port that decouples application use cases from the concrete Firestore
 * repository implementation. Tests inject a fake; production wires the
 * default repository-backed adapter.
 */
export interface PrescriptionPort {
  list: (hospitalId?: string) => Promise<PrescriptionRecord[]>;
  listByDateRange: (
    fromIsoDate: string,
    toIsoDate: string,
    hospitalId?: string
  ) => Promise<PrescriptionRecord[]>;
  get: (prescriptionId: string, hospitalId?: string) => Promise<PrescriptionRecord | null>;
  reassignPatient: (
    prescriptionId: string,
    patch: {
      bedId?: string;
      patientName?: string;
      patientRut?: string;
      assignmentScope?: PrescriptionAssignmentScope;
      reassignedBy: string;
      reassignedAt: string;
    },
    hospitalId?: string
  ) => Promise<PrescriptionRecord>;
  updateType: (
    prescriptionId: string,
    patch: {
      prescriptionType: PrescriptionType;
      updatedBy: string;
      updatedAt: string;
    },
    hospitalId?: string
  ) => Promise<PrescriptionRecord>;
  delete: (prescriptionId: string, hospitalId?: string) => Promise<void>;
  subscribeToList: (
    callback: (records: PrescriptionRecord[]) => void,
    hospitalId?: string
  ) => () => void;
}

export const defaultPrescriptionPort: PrescriptionPort = {
  list: async hospitalId => PrescriptionRepository.list(hospitalId),
  listByDateRange: async (fromIsoDate, toIsoDate, hospitalId) =>
    PrescriptionRepository.listByDateRange(fromIsoDate, toIsoDate, hospitalId),
  get: async (prescriptionId, hospitalId) => PrescriptionRepository.get(prescriptionId, hospitalId),
  reassignPatient: async (prescriptionId, patch, hospitalId) =>
    PrescriptionRepository.reassignPatient(prescriptionId, patch, hospitalId),
  updateType: async (prescriptionId, patch, hospitalId) =>
    PrescriptionRepository.updateType(prescriptionId, patch, hospitalId),
  delete: async (prescriptionId, hospitalId) =>
    PrescriptionRepository.delete(prescriptionId, hospitalId),
  subscribeToList: (callback, hospitalId) =>
    PrescriptionRepository.subscribeToList(callback, hospitalId),
};
