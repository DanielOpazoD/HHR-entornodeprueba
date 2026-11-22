import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

export interface ClinicalEventAuditPayload {
  action: AuditAction;
  entityType: AuditLogEntry['entityType'];
  entityId: string;
  details: Record<string, unknown>;
  patientRut?: string;
  recordDate?: string;
  authors?: string;
  waitMs: number;
}

export interface ClinicalEventSuccessFeedback {
  title: string;
  description: string;
}

export const buildClinicalEventAuditPayload = (
  action: 'CLINICAL_EVENT_ADDED' | 'CLINICAL_EVENT_DELETED',
  bedId: string,
  eventName: string,
  recordDate?: string
): ClinicalEventAuditPayload => ({
  action,
  entityType: 'patient',
  entityId: bedId,
  details: { event: eventName },
  patientRut: bedId,
  recordDate,
  authors: undefined,
  waitMs: 10000,
});

export const buildClinicalEventSuccessFeedback = (
  eventName: string
): ClinicalEventSuccessFeedback => ({
  title: 'Evento agregado',
  description: `Se ha registrado el evento: ${eventName}`,
});
