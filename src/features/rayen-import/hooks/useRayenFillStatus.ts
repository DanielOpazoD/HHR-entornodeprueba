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
import { logger } from '@/services/utils/loggerService';

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
  staffingOutcome: 'idle' | 'resolved' | 'pending' | 'applying' | 'ambiguous' | 'declined';
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

/**
 * Techo del vigilante del single-flight. Un fill legítimo de ~20 pacientes toma
 * 2–3 min; si el candado sigue tomado mucho más allá de eso es que algún await
 * interno nunca resolvió (pestaña de Rayen cerrada a mitad de corrida, service
 * worker reciclado, promesa perdida). Sin este techo, el botón «Sincronizar»
 * respondía «la revisión clínica anterior todavía está terminando» hasta
 * recargar la página.
 */
export const RAYEN_FILL_STALE_AFTER_MS = 8 * 60 * 1000;

let progress: RayenFillProgress = IDLE;
let activeAttemptId: number | null = null;
let runningSinceMs: number | null = null;
const listeners = new Set<() => void>();

const releaseStaleFill = (nowMs: number): boolean => {
  if (!progress.running) return false;
  if (runningSinceMs === null) {
    // Corrida heredada sin marca de inicio (p. ej. recarga en caliente): se le
    // da una ventana completa antes de poder considerarla colgada.
    runningSinceMs = nowMs;
    return false;
  }
  if (nowMs - runningSinceMs < RAYEN_FILL_STALE_AFTER_MS) return false;
  logger.warn(
    '[RayenFill] Un fill clínico quedó colgado más allá del techo del vigilante; se libera el candado.',
    { attemptId: progress.attemptId, runningForMs: runningSinceMs ? nowMs - runningSinceMs : null }
  );
  activeAttemptId = null;
  runningSinceMs = null;
  emit({
    ...progress,
    running: false,
    outcome: 'partial',
    errors: Math.max(progress.errors, 1),
  });
  return true;
};

const emit = (next: RayenFillProgress): void => {
  progress = next;
  for (const listener of listeners) listener();
};

/** Start a fill run. Returns false (and does nothing) if one is already running — single flight. */
export const beginRayenFill = (total: number, nowMs: number = Date.now()): boolean => {
  releaseStaleFill(nowMs);
  const attemptId = progress.attemptId + 1;
  if (progress.running) {
    // Preserve the older in-flight work, but make the latest rejected attempt explicit so its UI
    // can never inherit the eventual completion of that older run.
    emit({ ...progress, attemptId, outcome: 'rejected' });
    return false;
  }
  activeAttemptId = attemptId;
  runningSinceMs = nowMs;
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
export const resetRayenFillProgress = (nowMs: number = Date.now()): boolean => {
  releaseStaleFill(nowMs);
  if (progress.running || progress.staffingOutcome === 'applying') return false;
  activeAttemptId = null;
  runningSinceMs = null;
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

/** Finish the run, keeping patient counts separate from report-level/global failures. */
export const endRayenFill = (errors: number, hasAnyError: boolean = errors > 0): void => {
  const completedLatestAttempt = activeAttemptId === progress.attemptId;
  activeAttemptId = null;
  runningSinceMs = null;
  emit({
    running: false,
    outcome: completedLatestAttempt ? (hasAnyError ? 'partial' : 'complete') : progress.outcome,
    attemptId: progress.attemptId,
    done: progress.done,
    total: progress.total,
    errors: completedLatestAttempt ? errors : progress.errors,
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

/** Imperative snapshot used by the synchronization orchestrator when a worker settles. */
export const getRayenFillProgressSnapshot = (): RayenFillProgress => progress;

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
