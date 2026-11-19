import type { QuestionnaireResponse } from './transferDocuments';
import type { TransferStatus } from './transferStatusTypes';

/**
 * Snapshot of patient data at time of transfer request.
 * Preserved for historical accuracy even if patient record changes.
 */
export interface PatientSnapshot {
  name: string;
  rut: string;
  age: number;
  birthDate?: string;
  sex: 'M' | 'F';
  diagnosis: string;
  secondaryDiagnoses?: string[];
  admissionDate: string;
}

export interface TransferNote {
  id: string;
  content: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Record of a status change in the transfer workflow.
 */
export interface StatusChange {
  from: TransferStatus | null;
  to: TransferStatus;
  timestamp: string;
  userId: string;
  notes?: string;
  cancellationReason?: string;
}

/**
 * Main transfer request entity.
 */
export interface TransferRequest {
  id: string;
  patientId: string;
  bedId: string;
  patientSnapshot: PatientSnapshot;
  destinationHospital: string;
  transferReason: string;
  requestingDoctor: string;
  requiredSpecialty?: string;
  requiredBedType?: string;
  observations?: string;
  transferNotes?: TransferNote[];
  customFields: Record<string, string>;
  questionnaireResponses?: QuestionnaireResponse;
  status: TransferStatus;
  statusHistory: StatusChange[];
  requestDate: string;
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
