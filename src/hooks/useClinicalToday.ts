import { useCallback, useEffect, useState } from 'react';

import { resolveCurrentClinicalDay } from '@/utils/clinicalDayUtils';

const CLINICAL_TODAY_POLL_MS = 60_000;

/**
 * Reactive "clinical today" (YYYY-MM-DD) with the 08:00 business / 09:00 weekend
 * shift rollover applied (see resolveCurrentClinicalDay).
 *
 * Recomputes on a 60s interval and whenever the tab regains visibility, so an app
 * left open overnight (or across the morning rollover) advances to the new clinical
 * day instead of silently keeping the previous one. The pure resolution lives in
 * resolveCurrentClinicalDay; this hook only re-reads it on those triggers and keeps
 * the same reference when the value is unchanged (no spurious re-renders).
 */
export const useClinicalToday = (): string => {
  const [clinicalToday, setClinicalToday] = useState<string>(() => resolveCurrentClinicalDay());

  const refresh = useCallback(() => {
    setClinicalToday(previous => {
      const next = resolveCurrentClinicalDay();
      return next === previous ? previous : next;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, CLINICAL_TODAY_POLL_MS);
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refresh();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [refresh]);

  return clinicalToday;
};
