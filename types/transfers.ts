/**
 * Transfer Management Types
 * Types for the patient transfer request workflow
 */

import { QuestionnaireResponse } from './transferDocuments';

// ============================================================================
// Enums and Constants
// ============================================================================

/**
 * Transfer request status progression
 */
export type TransferStatus = 'REQUESTED' | 'SENT' | 'RECEIVED' | 'ACCEPTED' | 'TRANSFERRED' | 'CANCELLED';

/**
 * Status display configuration
 */
export const TRANSFER_STATUS_CONFIG: Record<TransferStatus, {
    label: string;
    color: string;
    bgColor: string;
}> = {
    REQUESTED: { label: 'Solicitado', color: 'text-amber-700', bgColor: 'bg-amber-100' },
    SENT: { label: 'Enviado', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    RECEIVED: { label: 'Recibido', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    ACCEPTED: { label: 'Aceptado', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
    TRANSFERRED: { label: 'Trasladado', color: 'text-slate-700', bgColor: 'bg-slate-100' },
    CANCELLED: { label: 'Cancelado', color: 'text-rose-700', bgColor: 'bg-rose-100' }
};

// ============================================================================
// Core Types
// ============================================================================

/**
 * Snapshot of patient data at time of transfer request
 * Preserved for historical accuracy even if patient record changes
 */
export interface PatientSnapshot {
    name: string;
    rut: string;
    age: number;
    birthDate?: string; // Date of birth from census
    sex: 'M' | 'F';
    diagnosis: string;
    secondaryDiagnoses?: string[];
    admissionDate: string;
}

/**
 * Record of a status change in the transfer workflow
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
 * Main transfer request entity
 */
export interface TransferRequest {
    id: string;

    // Patient reference
    patientId: string;
    bedId: string;
    patientSnapshot: PatientSnapshot;

    // Transfer details
    destinationHospital: string;
    transferReason: string;
    requestingDoctor: string;
    requiredSpecialty?: string;
    observations?: string;

    // Dynamic fields per hospital
    customFields: Record<string, string>;

    // Persistent questionnaire data
    questionnaireResponses?: QuestionnaireResponse;

    // Status tracking
    status: TransferStatus;
    statusHistory: StatusChange[];
    requestDate: string;

    // Archive tracking
    archived?: boolean;
    archivedAt?: string;

    // Metadata
    createdAt: string;
    updatedAt: string;
    createdBy: string;
}

/**
 * Form data for creating/editing a transfer request
 */
export interface TransferFormData {
    patientId: string;
    bedId: string;
    destinationHospital: string;
    transferReason: string;
    requestingDoctor: string;
    requiredSpecialty?: string;
    observations?: string;
    customFields?: Record<string, string>;
}

/**
 * Hospital template configuration
 */
export interface HospitalTemplate {
    id: string;
    name: string;
    requiredFields: string[];
    templateUrl?: string;
}
