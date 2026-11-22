import React from 'react';
import type {
  RayenImportCaptureOptions,
  RayenImportTriggerOutcome,
} from './rayenImportCaptureContracts';
import type { RayenFillProgress } from './useRayenFillStatus';

interface UseRayenAutoStartSyncParams {
  autoStartRequestId?: number;
  policyReady: boolean;
  bootstrapRecordReady: boolean;
  canAutoStart: boolean;
  fill: Pick<RayenFillProgress, 'running' | 'staleAtMs' | 'staffingOutcome'>;
  onAutoStart: (options: RayenImportCaptureOptions) => Promise<RayenImportTriggerOutcome>;
  onAutoStartHandled?: (requestId: number) => void;
}

/**
 * Coordinates automatic first-day Eloísa sync requests triggered after day bootstrap.
 *
 * Waits until policy, census record, extension health, and any prior clinical fill are ready
 * (releasing a hung fill once its watchdog deadline expires), and marks the request handled
 * only once a capture actually ran without being blocked.
 */
export const useRayenAutoStartSync = ({
  autoStartRequestId,
  policyReady,
  bootstrapRecordReady,
  canAutoStart,
  fill,
  onAutoStart,
  onAutoStartHandled,
}: UseRayenAutoStartSyncParams): void => {
  const autoStartHandledRef = React.useRef<number | null>(null);
  const autoStartInFlightRef = React.useRef<number | null>(null);

  // The fill store outlives the day: a synchronization of another day can still be reading.
  // Same condition under which `resetRayenFillProgress` makes the capture refuse, except a hung
  // reading: once its watchdog deadline passes, the next capture releases it, so the request
  // stops waiting and attempts (also when the deadline had already passed on mount).
  const fillStaleAtMs = fill.running && typeof fill.staleAtMs === 'number' ? fill.staleAtMs : null;
  const [expiredFillDeadline, setExpiredFillDeadline] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (autoStartRequestId === undefined || fillStaleAtMs === null) return undefined;
    const timer = window.setTimeout(
      () => setExpiredFillDeadline(fillStaleAtMs),
      Math.max(0, fillStaleAtMs - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [autoStartRequestId, fillStaleAtMs]);

  const hungFillReleasable = fillStaleAtMs !== null && expiredFillDeadline === fillStaleAtMs;
  const earlierFillBusy =
    (fill.running && !hungFillReleasable) || fill.staffingOutcome === 'applying';

  React.useEffect(() => {
    if (
      autoStartRequestId === undefined ||
      autoStartHandledRef.current === autoStartRequestId ||
      autoStartInFlightRef.current === autoStartRequestId
    ) {
      return;
    }
    // La solicitud sobrevive a la espera: sólo se marca como atendida cuando la captura dejó
    // evidencia (un run, aunque falle). Cada condición que hace rechazar la captura sin registrar
    // nada (fuentes, política, censo, lectura clínica anterior) se espera aquí, porque sólo un
    // cambio de estas dependencias vuelve a evaluar la solicitud.
    if (!policyReady || !bootstrapRecordReady || !canAutoStart || earlierFillBusy) return;
    autoStartInFlightRef.current = autoStartRequestId;
    // The census did not exist a moment ago; this first import defines the whole day, so it is
    // reviewed by a human, with the requirement recorded for this attempt.
    void onAutoStart({ reviewRequirement: 'day_bootstrap' }).then(outcome => {
      autoStartInFlightRef.current = null;
      if (outcome === 'blocked') return;
      autoStartHandledRef.current = autoStartRequestId;
      onAutoStartHandled?.(autoStartRequestId);
    });
  }, [
    autoStartRequestId,
    bootstrapRecordReady,
    canAutoStart,
    earlierFillBusy,
    onAutoStart,
    onAutoStartHandled,
    policyReady,
  ]);
};
