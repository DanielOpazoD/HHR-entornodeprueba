/**
 * Tiny module-level store for the Rayen background-fill status. The fill (devices/scales/CUDYR) runs
 * detached from the import button, and the census cells that display its results (DMI, Scores) live
 * far from the hook that runs it — so they subscribe here to show a loading animation while data is
 * still being fetched, and the button area can show real progress ("4/9") plus a completion summary
 * so the user can VERIFY the fill actually ran (or see how many patients failed).
 *
 * Also the single-flight guard: `beginRayenFill` refuses to start a second overlapping fill.
 */

import { useSyncExternalStore } from 'react';

export interface RayenFillProgress {
  running: boolean;
  done: number;
  total: number;
  /** Failed patients in the LAST completed fill (0 while running). */
  errors: number;
  /** ISO time of the last completed fill; null until one completes. */
  lastCompletedAt: string | null;
}

const IDLE: RayenFillProgress = {
  running: false,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
};

let progress: RayenFillProgress = IDLE;
const listeners = new Set<() => void>();

const emit = (next: RayenFillProgress): void => {
  progress = next;
  for (const listener of listeners) listener();
};

/** Start a fill run. Returns false (and does nothing) if one is already running — single flight. */
export const beginRayenFill = (total: number): boolean => {
  if (progress.running) return false;
  emit({ running: true, done: 0, total, errors: 0, lastCompletedAt: progress.lastCompletedAt });
  return true;
};

/** Report per-patient progress while the fill runs. */
export const reportRayenFillProgress = (done: number, total: number): void => {
  if (!progress.running) return;
  emit({ ...progress, done, total });
};

/** Finish the run, keeping a completion summary visible for the user. */
export const endRayenFill = (errors: number): void => {
  emit({
    running: false,
    done: progress.done,
    total: progress.total,
    errors,
    lastCompletedAt: new Date().toISOString(),
  });
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): RayenFillProgress => progress;
const getServerSnapshot = (): RayenFillProgress => IDLE;

/** Full fill progress (button area: "Sincronizando 4/9…", completion summary, error count). */
export const useRayenFillProgress = (): RayenFillProgress =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/** True while the Rayen background fill (devices/scales/CUDYR) is running — cell skeletons. */
export const useRayenFillStatus = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => progress.running,
    () => false
  );
