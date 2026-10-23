import { useCallback } from 'react';

import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { AuditAction } from '@/types/auditActionTypes';

type CoalescedAuditLogger = (
  action: AuditAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string,
  recordDate?: string,
  authors?: string,
  waitMs?: number
) => void;

/** Scoring a patient takes several clicks; one event per bed keeps every item's before/after. */
export const CUDYR_AUDIT_COALESCE_MS = 60 * 1000;

export const useCudyrAuditLoggers = (logCoalescedEvent: CoalescedAuditLogger) => {
  const logCudyrModified = useCallback(
    (
      bedId: string,
      patientName: string,
      rut: string,
      field: string,
      value: number,
      oldValue: number,
      recordDate: string,
      authors?: string
    ) => {
      logCoalescedEvent(
        'CUDYR_MODIFIED',
        'patient',
        bedId,
        {
          patientName,
          bedId,
          changes: {
            [field]: { old: oldValue, new: value },
          },
        },
        rut,
        recordDate,
        authors,
        CUDYR_AUDIT_COALESCE_MS
      );
    },
    [logCoalescedEvent]
  );

  return { logCudyrModified };
};
