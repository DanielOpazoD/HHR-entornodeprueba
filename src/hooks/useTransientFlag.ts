import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { useManagedTimeout } from '@/hooks/useManagedTimeout';

/**
 * State for a value that auto-reverts to `base` after `resetMs` — the transient
 * "Copiado" toast pattern shared across copy buttons.
 *
 * `flash(next)` sets the value and schedules the revert; the revert is skipped if
 * the value changed again meanwhile (a newer flash or a sticky `setValue` wins).
 * The timer is cleared on unmount and replaced on each `flash`.
 *
 * `setValue` is the raw setter for sticky states that must persist until the next
 * action (e.g. an error marker), so a single state variable can hold both a
 * transient success flag and a sticky failure flag.
 *
 * @example
 * const [copied, flashCopied] = useTransientFlag<string | null>(null, 1800);
 * flashCopied(examKey); // shows "Copiado" for 1.8s, then clears
 */
export function useTransientFlag<T>(
  base: T,
  resetMs: number
): [T, (next: T) => void, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(base);
  const setManagedTimeout = useManagedTimeout();

  const flash = useCallback(
    (next: T) => {
      setValue(next);
      setManagedTimeout(() => {
        setValue(current => (current === next ? base : current));
      }, resetMs);
    },
    [base, resetMs, setManagedTimeout]
  );

  return [value, flash, setValue];
}
