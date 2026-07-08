import { useCallback, useEffect, useRef } from 'react';

/**
 * Schedules a `setTimeout` whose handle is tracked and cleared automatically on
 * unmount (and replaced if scheduled again before it fires). Use it for deferred
 * `setState` / toast-reset timers so they can never run on an unmounted
 * component — the standard "state update on a gone component" leak.
 *
 * Single-timer semantics: each call clears the previous pending timeout, which
 * is exactly what toast/feedback resets want.
 *
 * @returns a stable `setManagedTimeout(callback, ms)` function.
 */
export const useManagedTimeout = (): ((callback: () => void, ms: number) => void) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return useCallback((callback: () => void, ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(callback, ms);
  }, []);
};
