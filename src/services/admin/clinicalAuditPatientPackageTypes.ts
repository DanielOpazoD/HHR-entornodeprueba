import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { ClinicalAuditChange } from '@/services/admin/clinicalAuditPresentation';

export const PATIENT_PACKAGE_WINDOW_MS = 10 * 60 * 1000;
export const UNKNOWN_AUDIT_SUBJECT = 'Paciente no identificado';

export interface ClinicalAuditPackageChange extends ClinicalAuditChange {
  sourceLogId: string;
}

export interface ClinicalAuditPackageFlags {
  admission: boolean;
  discharge: boolean;
  transfer: boolean;
  internalMovement: boolean;
  cma: boolean;
  conflict: boolean;
  diagnosis: boolean;
  status: boolean;
  risk: boolean;
}

export interface ClinicalAuditPatientPackageActor {
  label: string;
  secondary?: string;
  userId?: string;
  uid?: string;
}

export interface ClinicalAuditPatientPackage {
  id: string;
  packageKey: string;
  patientName: string;
  patientRut?: string;
  patientIdentifier?: string;
  recordDate: string;
  primaryBedLabel?: string;
  startedAt: string;
  endedAt: string;
  actors: ClinicalAuditPatientPackageActor[];
  ipAddresses: string[];
  actions: AuditAction[];
  modules: string[];
  changes: ClinicalAuditPackageChange[];
  flags: ClinicalAuditPackageFlags;
  eventCount: number;
  summary: string;
  rawLogs: AuditLogEntry[];
}
