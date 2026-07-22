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
  /** Outcome of the latest attempted fill, not an older overlapping run. */
  outcome: 'idle' | 'running' | 'complete' | 'partial' | 'rejected';
  /** Monotonic identity for the latest attempt, including single-flight rejections. */
  attemptId: number;
  done: number;
  total: number;
  /** Failed patients in the LAST completed fill (0 while running). */
  errors: number;
  /** ISO time of the last completed fill; null until one completes. */
  lastCompletedAt: string | null;
  /** User-decision state for the nursing proposal produced by this same synchronization. */
  staffingOutcome: 'idle' | 'resolved' | 'pending' | 'applying' | 'ambiguous';
}

const IDLE: RayenFillProgress = {
  running: false,
  outcome: 'idle',
  attemptId: 0,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  staffingOutcome: 'idle',
};

let progress: RayenFillProgress = IDLE;
let activeAttemptId: number | null = null;
const listeners = new Set<() => void>();

const emit = (next: RayenFillProgress): void => {
  progress = next;
  for (const listener of listeners) listener();
};

/** Start a fill run. Returns false (and does nothing) if one is already running — single flight. */
export const beginRayenFill = (total: number): boolean => {
  const attemptId = progress.attemptId + 1;
  if (progress.running) {
    // Preserve the older in-flight work, but make the latest rejected attempt explicit so its UI
    // can never inherit the eventual completion of that older run.
    emit({ ...progress, attemptId, outcome: 'rejected' });
    return false;
  }
  activeAttemptId = attemptId;
  emit({
    running: true,
    outcome: 'running',
    attemptId,
    done: 0,
    total,
    errors: 0,
    lastCompletedAt: progress.lastCompletedAt,
    staffingOutcome: progress.staffingOutcome,
  });
  return true;
};

/** Clear evidence from an earlier run before requesting a new Eloísa snapshot. */
export const resetRayenFillProgress = (): boolean => {
  if (progress.running) return false;
  activeAttemptId = null;
  emit({ ...IDLE, attemptId: progress.attemptId });
  return true;
};

export const getRayenFillAttemptId = (): number => progress.attemptId;

export const isRayenFillAttemptCurrent = (attemptId: number): boolean =>
  progress.attemptId === attemptId && progress.outcome !== 'rejected';

/**
 * Invalidate the active attempt without aborting its best-effort clinical writes. Late callbacks
 * can finish their work, but they can no longer publish staffing UI or revive a dismissed flow.
 * A new fill remains single-flight blocked until the invalidated worker settles.
 */
export const invalidateRayenFillAttempt = (): boolean => {
  if (activeAttemptId === null || !progress.running) return false;
  activeAttemptId = null;
  emit({
    ...progress,
    attemptId: progress.attemptId + 1,
    outcome: 'rejected',
    staffingOutcome: 'resolved',
  });
  return true;
};

export const reportRayenStaffingOutcome = (
  staffingOutcome: RayenFillProgress['staffingOutcome'],
  attemptId: number = progress.attemptId
): boolean => {
  if (attemptId !== progress.attemptId) return false;
  emit({ ...progress, staffingOutcome });
  return true;
};

/** Report per-patient progress while the fill runs. */
export const reportRayenFillProgress = (done: number, total: number): void => {
  if (!progress.running) return;
  emit({ ...progress, done, total });
};

/** Finish the run, keeping a completion summary visible for the user. */
export const endRayenFill = (errors: number): void => {
  const completedLatestAttempt = activeAttemptId === progress.attemptId;
  activeAttemptId = null;
  emit({
    running: false,
    outcome: completedLatestAttempt ? (errors > 0 ? 'partial' : 'complete') : progress.outcome,
    attemptId: progress.attemptId,
    done: progress.done,
    total: progress.total,
    errors,
    lastCompletedAt: completedLatestAttempt ? new Date().toISOString() : progress.lastCompletedAt,
    staffingOutcome: progress.staffingOutcome,
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
