import React, { useCallback } from 'react';

import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildDebouncedAuditKey,
  buildMeaningfulAuditDetails,
  mergeDebouncedAuditDetails,
  type PendingAuditEntry,
} from '@/hooks/controllers/auditLogPolicyController';
import { registerPendingAuditFlush } from '@/services/admin/auditPendingEvents';

const changedFields = (details: Record<string, unknown> | null): string[] => {
  const changes = details?.changes;
  return changes && typeof changes === 'object' ? Object.keys(changes) : [];
};

type RecordAuditEvent = (
  action: AuditAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string,
  recordDate?: string,
  authors?: string
) => Promise<void>;

/**
 * Edit bursts become one event: the first "before" and the last "after" of each field, written
 * after `waitMs` without changes, or right away when the tab hides, the page closes or the
 * session ends. Fields that end where they began are still recorded, as `reverted`.
 */
export const useCoalescedAuditLogger = (recordEvent: RecordAuditEvent) => {
  const timersRef = React.useRef<Record<string, PendingAuditEntry>>({});

  React.useEffect(() => {
    const flushPending = async (): Promise<void> => {
      await Promise.all(Object.values(timersRef.current).map(entry => entry.flush?.()));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flushPending();
    };
    const onPageHide = () => void flushPending();
    const unregister = registerPendingAuditFlush(flushPending);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      void flushPending();
    };
  }, []);

  return useCallback(
    (
      action: AuditAction,
      entityType: AuditLogEntry['entityType'],
      entityId: string,
      details: Record<string, unknown>,
      patientRut?: string,
      recordDate?: string,
      authors?: string,
      waitMs: number = 5 * 60 * 1000
    ) => {
      // The same bed may hold another patient or census day within the window.
      const key = `${buildDebouncedAuditKey(action, entityId)}|${recordDate ?? ''}|${patientRut ?? ''}`;
      const reported = changedFields(buildMeaningfulAuditDetails(details));
      // A save that changed nothing must not replace the burst's before/after.
      if (details.changes && reported.length === 0) return;
      const pending = timersRef.current[key];
      const mergedDetails = mergeDebouncedAuditDetails(pending?.details || null, details);
      if (!mergedDetails) {
        return;
      }

      if (pending) {
        window.clearTimeout(pending.timer);
      }

      const flush = (): Promise<void> => {
        const entry = timersRef.current[key];
        if (!entry) return Promise.resolve();
        window.clearTimeout(entry.timer);
        delete timersRef.current[key];
        const netChanges = changedFields(entry.details);
        const reverted = (entry.touched ?? []).filter(field => !netChanges.includes(field));
        return recordEvent(
          action,
          entityType,
          entityId,
          reverted.length > 0 ? { ...entry.details, reverted } : entry.details,
          entry.rut,
          entry.date,
          entry.authors
        );
      };

      timersRef.current[key] = {
        timer: window.setTimeout(() => void flush(), waitMs),
        details: mergedDetails,
        rut: patientRut,
        date: recordDate,
        authors,
        flush,
        touched: [...new Set([...(pending?.touched ?? []), ...reported])],
      };
    },
    [recordEvent]
  );
};
