/**
 * Tiny module-level store for the Rayen background-fill status. The fill (devices/scales/CUDYR) runs
 * detached from the import button, and the census cells that display its results (DMI, Scores) live
 * far from the hook that runs it — so they subscribe here to show a loading animation while data is
 * still being fetched, instead of looking empty and making the user think nothing is happening.
 */

import { useSyncExternalStore } from 'react';

let filling = false;
const listeners = new Set<() => void>();

/** Toggle the "background fill in progress" flag (called by the Rayen import hook). */
export const setRayenFilling = (value: boolean): void => {
  if (filling === value) return;
  filling = value;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True while the Rayen background fill (devices/scales/CUDYR) is running. */
export const useRayenFillStatus = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => filling,
    () => false
  );
