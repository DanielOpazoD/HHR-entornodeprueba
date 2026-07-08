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

/**
 * Patient + DailyRecord lifecycle audit emitters, extracted out of useAudit
 * to keep the hook under the 400-LOC module-size guardrail and to mirror the
 * pattern used by useClinicalDocumentAuditLoggers, useCudyrAuditLoggers and
 * useHandoffAuditLoggers (one feature surface, one tightly scoped logger
 * group). Each callback is a thin shape adapter over the canonical logEvent
 * provided by useAudit.
 */
export const usePatientLifecycleAuditLoggers = (logEvent: AuditLogger) => {
  const logPatientAdmission = useCallback(
    (bedId: string, patientName: string, rut: string, recordDate: string) => {
      logEvent('PATIENT_ADMITTED', 'patient', bedId, { patientName, bedId }, rut, recordDate);
    },
    [logEvent]
  );

  const logPatientDischarge = useCallback(
    (bedId: string, patientName: string, rut: string, status: string, recordDate: string) => {
      logEvent(
        'PATIENT_DISCHARGED',
        'discharge',
        bedId,
        { patientName, status, bedId, rut },
        rut,
        recordDate
      );
    },
    [logEvent]
  );

  const logPatientTransfer = useCallback(
    (bedId: string, patientName: string, rut: string, destination: string, recordDate: string) => {
      logEvent(
        'PATIENT_TRANSFERRED',
        'transfer',
        bedId,
        { patientName, destination, bedId, rut },
        rut,
        recordDate
      );
    },
    [logEvent]
  );

  const logPatientCleared = useCallback(
    (bedId: string, patientName: string, rut: string, recordDate: string) => {
      logEvent('PATIENT_CLEARED', 'patient', bedId, { patientName, bedId }, rut, recordDate);
    },
    [logEvent]
  );

  const logDailyRecordDeleted = useCallback(
    (date: string) => {
      logEvent('DAILY_RECORD_DELETED', 'dailyRecord', date, { date }, undefined, date);
    },
    [logEvent]
  );

  const logDailyRecordCreated = useCallback(
    (date: string, copiedFrom?: string) => {
      logEvent('DAILY_RECORD_CREATED', 'dailyRecord', date, { date, copiedFrom }, undefined, date);
    },
    [logEvent]
  );

  return {
    logPatientAdmission,
    logPatientDischarge,
    logPatientTransfer,
    logPatientCleared,
    logDailyRecordDeleted,
    logDailyRecordCreated,
  };
};
