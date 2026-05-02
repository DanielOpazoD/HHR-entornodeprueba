import { useCallback } from 'react';

import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { AuditAction } from '@/types/auditActionTypes';

type AuditLogger = (
  action: AuditAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string,
  recordDate?: string,
  authors?: string
) => void;

const CUDYR_MODIFIED_THROTTLE_MS = 15 * 60 * 1000;

const getCudyrThrottleKey = (bedId: string): string => `hhr_audit_throttle_CUDYR_MODIFIED_${bedId}`;

const shouldLogCudyrAction = (bedId: string): boolean => {
  if (typeof sessionStorage === 'undefined') return true;

  const stateKey = getCudyrThrottleKey(bedId);
  const lastLogged = sessionStorage.getItem(stateKey);
  if (lastLogged) {
    const elapsed = Date.now() - new Date(lastLogged).getTime();
    if (elapsed < CUDYR_MODIFIED_THROTTLE_MS) {
      return false;
    }
  }

  sessionStorage.setItem(stateKey, new Date().toISOString());
  return true;
};

export const useCudyrAuditLoggers = (logEvent: AuditLogger) => {
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
      if (!shouldLogCudyrAction(bedId)) {
        return;
      }

      logEvent(
        'CUDYR_MODIFIED',
        'patient',
        bedId,
        {
          patientName,
          bedId,
          lastField: field,
          lastValue: value,
          changes: {
            [field]: { old: oldValue, new: value },
          },
        },
        rut,
        recordDate,
        authors
      );
    },
    [logEvent]
  );

  return { logCudyrModified };
};
