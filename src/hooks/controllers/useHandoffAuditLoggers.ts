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
 * Novedades are typed in many saves; the trail keeps one event per editing burst with the text
 * before the first save and after the last one. Each shift is its own field, so day and night
 * novedades never mix in one before/after.
 */
export const HANDOFF_AUDIT_COALESCE_MS = 60 * 1000;

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

  return { logHandoffNovedadesModified };
};
