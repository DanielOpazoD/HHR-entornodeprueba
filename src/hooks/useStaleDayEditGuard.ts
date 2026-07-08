import { useCallback, useRef } from 'react';

import { useUI } from '@/context/UIContext';
import { useAuditContext } from '@/context/AuditContext';
import { resolveStaleDayEditDecision } from '@/hooks/controllers/staleDayEditController';
import { getPreviousDay } from '@/utils/clinicalDayUtils';
import { formatDateForDisplay } from '@/utils/dateDisplayUtils';

/** Gate the bed-management dispatcher calls before editing a record's day. */
export type StaleDayEditGuard = (recordDate: string) => Promise<boolean>;

const parseLocalDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/**
 * Guards edits made to a clinical day other than the clinical "today".
 *
 * `clinicalToday` is injected (a single source of truth shared with the date strip
 * and banner) so the guard never drifts from the UI around the shift rollover.
 *
 * The first time the user edits a given stale (past) day in this session it asks for
 * an explicit confirmation that names both concrete dates and records a
 * PREVIOUS_DAY_EDIT_CONFIRMED audit event; afterwards that day is remembered so edits
 * flow without re-prompting (one confirm per day). Concurrent edits to the same day
 * share a single in-flight confirmation, and audit logging is best-effort — a failure
 * to log never blocks a confirmed edit.
 */
export const useStaleDayEditGuard = (clinicalToday: string): StaleDayEditGuard => {
  const { confirm } = useUI();
  const { logEvent } = useAuditContext();
  const confirmedDaysRef = useRef<Set<string>>(new Set());
  const pendingConfirmationsRef = useRef<Map<string, Promise<boolean>>>(new Map());

  return useCallback(
    async (recordDate: string): Promise<boolean> => {
      // E2E builds seed fixed past dates and drive edits with no human to dismiss the
      // dialog, so the guard would block every edit. Step aside under strict E2E mode
      // (VITE_E2E_MODE only — NOT localhost dev or prod, where the guard stays active).
      // The guard's own behavior is covered by this file's unit tests.
      if (import.meta.env.VITE_E2E_MODE === 'true') {
        return true;
      }

      // Coalesce overlapping edits to the same day onto one dialog (no double prompt
      // or double audit under rapid repeated actions).
      const pending = pendingConfirmationsRef.current.get(recordDate);
      if (pending) {
        return pending;
      }

      const decision = resolveStaleDayEditDecision({
        currentDateString: recordDate,
        clinicalToday,
        alreadyConfirmed: confirmedDaysRef.current.has(recordDate),
      });
      if (decision === 'allowed') {
        return true;
      }

      const isYesterday = getPreviousDay(clinicalToday) === recordDate;
      const viewedLabel = formatDateForDisplay(parseLocalDate(recordDate));
      const todayLabel = formatDateForDisplay(parseLocalDate(clinicalToday));

      const confirmationPromise = confirm({
        variant: 'warning',
        title: '¿Editar un día anterior?',
        message:
          `Estás por modificar el ${viewedLabel}${isYesterday ? ' (ayer)' : ''}. ` +
          `El día de hoy es ${todayLabel}. El cambio quedará registrado en la auditoría.`,
        confirmText: 'Sí, editar ese día',
        cancelText: 'Ir a hoy',
      });
      pendingConfirmationsRef.current.set(recordDate, confirmationPromise);
      const confirmed = await confirmationPromise.finally(() => {
        pendingConfirmationsRef.current.delete(recordDate);
      });
      if (!confirmed) {
        return false;
      }

      confirmedDaysRef.current.add(recordDate);
      try {
        logEvent(
          'PREVIOUS_DAY_EDIT_CONFIRMED',
          'dailyRecord',
          recordDate,
          { viewedDate: recordDate, clinicalToday },
          undefined,
          recordDate
        );
      } catch {
        // Best-effort audit (policy: bestEffortObservable) — never block the edit.
      }
      return true;
    },
    [clinicalToday, confirm, logEvent]
  );
};
