import { useCallback } from 'react';

import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

type AuditLogger = (
  action: AuditAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string,
  recordDate?: string,
  authors?: string
) => void;

const HANDOFF_MODIFIED_THROTTLE_MS = 5 * 60 * 1000;

const getHandoffThrottleKey = (action: AuditAction, bedId: string): string =>
  `hhr_audit_throttle_${action}_${bedId}`;

const shouldLogHandoffAction = (action: AuditAction, bedId: string): boolean => {
  if (typeof sessionStorage === 'undefined') return true;

  const stateKey = getHandoffThrottleKey(action, bedId);
  const lastLogged = sessionStorage.getItem(stateKey);
  if (lastLogged) {
    const elapsed = Date.now() - new Date(lastLogged).getTime();
    if (elapsed < HANDOFF_MODIFIED_THROTTLE_MS) {
      return false;
    }
  }

  sessionStorage.setItem(stateKey, new Date().toISOString());
  return true;
};

export const useHandoffAuditLoggers = (logEvent: AuditLogger) => {
  const logHandoffNovedadesModified = useCallback(
    (shift: string, content: string, oldContent: string, recordDate: string, authors?: string) => {
      logEvent(
        'HANDOFF_NOVEDADES_MODIFIED',
        'dailyRecord',
        recordDate,
        {
          shift,
          content,
          changes: {
            novedades: { old: oldContent, new: content },
          },
        },
        undefined,
        recordDate,
        authors
      );
    },
    [logEvent]
  );

  const logMedicalHandoffModified = useCallback(
    (
      bedId: string,
      patientName: string,
      rut: string,
      note: string,
      oldNote: string,
      recordDate: string
    ) => {
      if (!shouldLogHandoffAction('MEDICAL_HANDOFF_MODIFIED', bedId)) {
        return;
      }

      logEvent(
        'MEDICAL_HANDOFF_MODIFIED',
        'patient',
        bedId,
        {
          patientName,
          bedId,
          rut,
          note,
          changes: {
            note: { old: oldNote, new: note },
          },
        },
        rut,
        recordDate
      );
    },
    [logEvent]
  );

  const logNurseHandoffModified = useCallback(
    (
      bedId: string,
      patientName: string,
      rut: string,
      shift: string,
      note: string,
      oldNote: string,
      recordDate: string
    ) => {
      if (!shouldLogHandoffAction('NURSE_HANDOFF_MODIFIED', bedId)) {
        return;
      }

      logEvent(
        'NURSE_HANDOFF_MODIFIED',
        'patient',
        bedId,
        {
          patientName,
          bedId,
          rut,
          shift,
          note,
          changes: {
            note: { old: oldNote, new: note },
          },
        },
        rut,
        recordDate
      );
    },
    [logEvent]
  );

  return { logHandoffNovedadesModified, logMedicalHandoffModified, logNurseHandoffModified };
};
