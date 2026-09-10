/**
 * Wall-clock ceiling for the clinical stage of one synchronization.
 *
 * Every Eloísa read has its own timeout, but nothing bounded the stage as a whole: ~20 patients
 * at concurrency 4 with retries is 2–3 minutes, and a lost promise kept the run in
 * `syncing_clinical` until the 8-minute single-flight lock gave up (which only freed the button;
 * the worker kept reading and writing). The watchdog aborts the reads that have not started,
 * skips writes for patients still in flight, and lets the batch persist what was already read.
 */
export const RAYEN_CLINICAL_STAGE_TIMEOUT_MS = 5 * 60 * 1000;

/** Message deliberately says "timeout" (classified as such) and never "aborted" (concurrency). */
export const CLINICAL_FILL_TIMEOUT_MESSAGE =
  'Clinical stage timeout: la etapa clínica superó su tiempo máximo y se conservó el avance leído.';

export const createClinicalFillTimeoutError = (): Error =>
  Object.assign(new Error(CLINICAL_FILL_TIMEOUT_MESSAGE), { name: 'TimeoutError' });

export interface ClinicalFillWatchdog {
  signal: AbortSignal;
  /** Stops the stage early (stale lock, operator cancel); idempotent. */
  abort: () => void;
  /** Clears the timer once the stage settled. */
  settle: () => void;
}

export const createClinicalFillWatchdog = ({
  timeoutMs = RAYEN_CLINICAL_STAGE_TIMEOUT_MS,
  onTimeout,
}: {
  timeoutMs?: number;
  onTimeout?: () => void;
} = {}): ClinicalFillWatchdog => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    controller.abort(createClinicalFillTimeoutError());
    onTimeout?.();
  }, timeoutMs);
  return {
    signal: controller.signal,
    abort: () => {
      clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort(createClinicalFillTimeoutError());
    },
    settle: () => clearTimeout(timer),
  };
};
