import { useState } from 'react';

/**
 * True in the first render and in each render where a value of `deps` differs (Object.is) from
 * the previous one: the same moments an effect with those dependencies would run. Use it to set
 * state while rendering, as React recommends, instead of an effect that sets state after the
 * stale render was already shown:
 *
 *   if (useChangedOnRender([patientId])) setDraft(emptyDraft);
 *
 * React discards the render that sets state and renders again before painting or running
 * effects. Only state goes there; anything else (a request, a timer, the DOM) stays in an effect.
 * Each dependency must keep its identity between renders (a primitive, state or a memoized
 * value): a new object per render would set state on every render without end.
 */
export const useChangedOnRender = (deps: readonly unknown[]): boolean => {
  const [seen, setSeen] = useState<readonly unknown[] | null>(null);
  const changed =
    seen === null ||
    seen.length !== deps.length ||
    deps.some((value, index) => !Object.is(value, seen[index]));
  if (changed) setSeen(deps);
  return changed;
};
