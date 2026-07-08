/**
 * usePatientRowOrbitalLauncherMachine.ts
 *
 * A minimal state-machine hook that governs the four visual phases of the
 * orbital quick-action launcher:
 *
 *   idle  -->  armed  -->  open  -->  closing  -->  idle
 *
 * Phase semantics:
 *   - **idle**: trigger is hidden; the launcher is dormant.
 *   - **armed**: the user's pointer entered the patient row (or touch
 *     interaction began). The trigger fades in and is clickable.
 *   - **open**: the user clicked the trigger; the action stack is visible.
 *   - **closing**: the pointer left and no grace period saved it.
 *     The trigger is hidden immediately while the state resets.
 *
 * Timing constants (`REVEAL_DELAY_MS`, `CLOSE_RESET_DELAY_MS`) control
 * how quickly transitions happen. They are exported so integration tests
 * can reference the same values instead of hard-coding magic numbers.
 */

import React from 'react';

export type PatientRowOrbitalLauncherPhase = 'idle' | 'armed' | 'open' | 'closing';

interface PatientRowOrbitalLauncherMachineParams {
  canRevealTrigger: boolean;
  isOpen: boolean;
  supportsHoverFine: boolean;
}

interface PatientRowOrbitalLauncherMachineResult {
  phase: PatientRowOrbitalLauncherPhase;
  showTrigger: boolean;
}

type LauncherMachineAction =
  | { type: 'ARM' }
  | { type: 'OPEN' }
  | { type: 'START_CLOSE' }
  | { type: 'RESET' };

interface LauncherMachineState {
  phase: PatientRowOrbitalLauncherPhase;
}

/**
 * Delay before transitioning from idle to armed (ms).
 *
 * Set to 0 so the trigger appears instantly on hover -- the synchronous
 * dispatch path avoids a needless `setTimeout(fn, 0)` round-trip that would
 * cause a visible flicker on fast pointer movements.
 */
export const REVEAL_DELAY_MS = 0;

/**
 * Delay before the closing phase resets back to idle (ms).
 * Kept short so ownership/state cleanup remains snappy without leaving
 * visible hover ghosts when the pointer sweeps across many rows.
 */
export const CLOSE_RESET_DELAY_MS = 50;

/**
 * Pure reducer for the launcher state machine.
 *
 * Transition rules:
 * - `ARM`         -- moves to `armed` unless already `open` (open takes precedence).
 * - `OPEN`        -- moves to `open` unconditionally.
 * - `START_CLOSE` -- moves to `closing` unless already `idle` (no-op guard).
 * - `RESET`       -- returns to `idle` unconditionally.
 */
const reducer = (
  state: LauncherMachineState,
  action: LauncherMachineAction
): LauncherMachineState => {
  if (action.type === 'ARM') {
    if (state.phase === 'open') {
      return state;
    }
    return { phase: 'armed' };
  }

  if (action.type === 'OPEN') {
    return { phase: 'open' };
  }

  if (action.type === 'START_CLOSE') {
    if (state.phase === 'idle') {
      return state;
    }
    return { phase: 'closing' };
  }

  return { phase: 'idle' };
};

/**
 * Drives the launcher phase in response to three external signals:
 *
 * - `canRevealTrigger` -- true when the runtime decides the trigger should
 *   be visible (hover, focus, ownership, etc.).
 * - `isOpen` -- true when the action stack is expanded.
 * - `supportsHoverFine` -- false on touch devices; when false the trigger
 *   is always shown and the phase skips directly to armed/open.
 *
 * Internally it manages two timers:
 *   1. **Reveal timer** -- delays the idle-to-armed transition by
 *      `REVEAL_DELAY_MS` (currently 0, so the dispatch is synchronous).
 *   2. **Close timer** -- after entering `closing`, waits
 *      `CLOSE_RESET_DELAY_MS` before dispatching `RESET`.
 *
 * Both timers are cleaned up on unmount.
 */
export const usePatientRowOrbitalLauncherMachine = ({
  canRevealTrigger,
  isOpen,
  supportsHoverFine,
}: PatientRowOrbitalLauncherMachineParams): PatientRowOrbitalLauncherMachineResult => {
  const [{ phase }, dispatch] = React.useReducer(reducer, { phase: 'idle' });
  const revealTimerRef = React.useRef<number | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);

  const clearRevealTimer = React.useCallback(() => {
    if (revealTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!supportsHoverFine) {
      dispatch({ type: isOpen ? 'OPEN' : 'ARM' });
      return;
    }

    if (isOpen) {
      clearRevealTimer();
      clearCloseTimer();
      dispatch({ type: 'OPEN' });
      return;
    }

    if (canRevealTrigger) {
      clearCloseTimer();
      if (phase === 'idle' || phase === 'closing') {
        clearRevealTimer();
        if (REVEAL_DELAY_MS <= 0) {
          // Synchronous dispatch: when the delay is 0 we skip setTimeout
          // entirely to avoid a microtask gap that would cause a visible
          // frame where the trigger is absent during fast hover sweeps.
          dispatch({ type: 'ARM' });
        } else {
          revealTimerRef.current = window.setTimeout(() => {
            dispatch({ type: 'ARM' });
            revealTimerRef.current = null;
          }, REVEAL_DELAY_MS);
        }
      }
      return;
    }

    clearRevealTimer();
    if (phase !== 'idle' && phase !== 'closing') {
      dispatch({ type: 'START_CLOSE' });
    }
    if (phase !== 'idle') {
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(() => {
        dispatch({ type: 'RESET' });
        closeTimerRef.current = null;
      }, CLOSE_RESET_DELAY_MS);
    }
  }, [canRevealTrigger, clearCloseTimer, clearRevealTimer, isOpen, phase, supportsHoverFine]);

  React.useEffect(() => {
    return () => {
      clearRevealTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearRevealTimer]);

  return {
    phase,
    showTrigger: !supportsHoverFine || (phase !== 'idle' && phase !== 'closing'),
  };
};
