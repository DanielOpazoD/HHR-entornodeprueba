import type { AuditLogEntry } from '@/types/auditLogTypes';

let sequence = 0;

/** Synthetic audit document; times are UTC instants (Rapa Nui is UTC-5 in October 2026). */
export const auditLog = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => {
  sequence += 1;
  return {
    id: `audit-${sequence}`,
    timestamp: '2026-10-22T14:00:00.000Z',
    userId: 'enfermera.uno@hospital.test',
    userDisplayName: 'Enfermera Uno',
    action: 'PATIENT_MODIFIED',
    entityType: 'patient',
    entityId: 'H1C1',
    details: {},
    ...overrides,
  };
};

export const patientDetails = (
  patientName: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({ patientName, bedId: 'H1C1', ...extra });
