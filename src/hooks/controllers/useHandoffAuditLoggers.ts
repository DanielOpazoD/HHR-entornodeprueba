import { useCallback } from 'react';

import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

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

/**
 * A note is typed in many saves; the trail keeps one event per editing burst with the text
 * before the first save and after the last one. Each shift is its own field, so day and night
 * notes never mix in one before/after.
 */
export const HANDOFF_AUDIT_COALESCE_MS = 60 * 1000;

const NURSE_NOTE_FIELDS: Record<string, string> = {
  day: 'handoffNoteDayShift',
  night: 'handoffNoteNightShift',
};

const NOVEDADES_FIELDS: Record<string, string> = {
  day: 'handoffNovedadesDayShift',
  night: 'handoffNovedadesNightShift',
};

export const useHandoffAuditLoggers = (logCoalescedEvent: CoalescedAuditLogger) => {
  const logHandoffNovedadesModified = useCallback(
    (shift: string, content: string, oldContent: string, recordDate: string, authors?: string) => {
      logCoalescedEvent(
        'HANDOFF_NOVEDADES_MODIFIED',
        'dailyRecord',
        recordDate,
        {
          shift,
          changes: {
            [NOVEDADES_FIELDS[shift] ?? 'novedades']: { old: oldContent, new: content },
          },
        },
        undefined,
        recordDate,
        authors,
        HANDOFF_AUDIT_COALESCE_MS
      );
    },
    [logCoalescedEvent]
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
      logCoalescedEvent(
        'MEDICAL_HANDOFF_MODIFIED',
        'patient',
        bedId,
        {
          patientName,
          bedId,
          rut,
          changes: {
            medicalHandoffNote: { old: oldNote, new: note },
          },
        },
        rut,
        recordDate,
        undefined,
        HANDOFF_AUDIT_COALESCE_MS
      );
    },
    [logCoalescedEvent]
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
      logCoalescedEvent(
        'NURSE_HANDOFF_MODIFIED',
        'patient',
        bedId,
        {
          patientName,
          bedId,
          rut,
          shift,
          changes: {
            [NURSE_NOTE_FIELDS[shift] ?? 'handoffNote']: { old: oldNote, new: note },
          },
        },
        rut,
        recordDate,
        undefined,
        HANDOFF_AUDIT_COALESCE_MS
      );
    },
    [logCoalescedEvent]
  );

  return { logHandoffNovedadesModified, logMedicalHandoffModified, logNurseHandoffModified };
};
