import {
  captureAuthoringSession,
  isAuthoringSessionCurrent,
  type AuthoringSession,
} from '@/services/storage/authoringSession';

/** What a Rayen run needs to keep going after a wait. */
export interface RayenRunScope {
  /** The session that began the run, or the stage, as captured when it began. */
  session: AuthoringSession;
  /** Before the structure commits: the view that owns the run is still mounted. */
  isMounted?: () => boolean;
  /** Before the structure commits: the run is still the execution on screen. */
  isExecutionCurrent?: () => boolean;
}

/**
 * The one question every continuation of a Rayen run asks after a wait: may this run still act?
 * Its session must still hold this browser, and a logout already in progress counts as ended
 * (`isAuthoringSessionCurrent`). Before the structure commits, the run also stops when its view
 * unmounts or another execution replaced it; once committed only the session matters, so the
 * confirmed handoff still converges when its view went away in the same session. A run that is
 * no longer alive stops without writing, showing or reporting anything.
 */
export const isRayenRunAlive = ({ session, isMounted, isExecutionCurrent }: RayenRunScope) =>
  isAuthoringSessionCurrent(session) && (isMounted?.() ?? true) && (isExecutionCurrent?.() ?? true);

/** Throws where a continuation is a chain of writes; callers treat it as the run stopping. */
export const assertRayenRunAlive = (scope: RayenRunScope): void => {
  if (!isRayenRunAlive(scope)) throw new Error('La sesión cambió.');
};

/** The session a run began in; a run built outside `startRun` takes the current one. */
export const rayenRunSession = (run?: { authoringSession?: AuthoringSession } | null) =>
  run?.authoringSession ?? captureAuthoringSession();
