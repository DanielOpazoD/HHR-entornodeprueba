import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import {
  getDailyRecordFreshnessStatus,
  subscribeDailyRecordFreshness,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { ensureFreshDailyRecordQuery } from '@/hooks/controllers/dailyRecordMutationFreshnessController';

export const DAILY_RECORD_FRESHNESS_RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000] as const;

/** A check that could not confirm keeps trying by itself, so nobody has to reload to edit again. */
export const useDailyRecordFreshnessRecovery = (
  date: string,
  enabled: boolean,
  dailyRecord: DailyRecordRepositoryPort,
  queryClient: QueryClient
): void => {
  useEffect(() => {
    if (!enabled) return;

    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      timer = undefined;
      const status = getDailyRecordFreshnessStatus(date);
      if (status === 'fresh_remote_confirmed') attempt = 0;
      if (status !== 'blocked_until_remote_check') return;
      const delays = DAILY_RECORD_FRESHNESS_RETRY_DELAYS_MS;
      timer = setTimeout(
        () => {
          // A hidden or offline tab gains nothing from reading; returning or reconnecting reads anyway.
          if (document.visibilityState !== 'visible' || navigator.onLine === false) {
            schedule();
            return;
          }
          attempt += 1;
          // The gate records the failure and returns to blocked, which schedules the next attempt.
          void ensureFreshDailyRecordQuery(date, { dailyRecord, queryClient }, 'resume').catch(
            () => {}
          );
        },
        delays[Math.min(attempt, delays.length - 1)]
      );
    };

    const unsubscribe = subscribeDailyRecordFreshness(schedule);
    schedule();
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [date, enabled, dailyRecord, queryClient]);
};
