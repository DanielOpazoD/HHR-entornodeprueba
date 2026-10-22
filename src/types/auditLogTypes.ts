import type { AuditAction } from './auditActionTypes';
import type { AuditDetails } from './auditDetailTypes';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userDisplayName?: string;
  userUid?: string;
  ipAddress?: string;
  action: AuditAction;
  entityType:
    | 'patient'
    | 'discharge'
    | 'transfer'
    | 'dailyRecord'
    | 'user'
    | 'system'
    | 'clinicalDocument'
    | 'prescription'
    | 'medicalIndicationRecord'
    | 'medicalIndicationTemplate'
    | 'statistics';
  entityId: string;
  summary?: string;
  details: AuditDetails;
  patientIdentifier?: string;
  recordDate?: string;
  authors?: string;
  /** 2 for events written by the audit trail model (session-scoped, compacted details). */
  schemaVersion?: number;
  /** Connection session of the device that recorded the event. */
  sessionId?: string;
  /** Coarse device label, e.g. `Chrome · Windows`. */
  device?: string;
}

export const maskRut = (rut: string): string => {
  if (!rut || rut.length < 4) return '***';
  const parts = rut.split('-');
  if (parts.length === 2) {
    const body = parts[0];
    return body.slice(0, -3) + '***-*';
  }
  return rut.slice(0, -4) + '***';
};
