import { getSessionGeneration } from './sessionStorageTransition';
import { getStoredSessionOwnerKey, isSessionCleanupPending } from './sessionOwnerKey';

/** The person and session that began a write: whose intent it carries, whatever happens later. */
export interface AuthoringSession {
  ownerKey: string | null;
  generation: string | null;
}

export const captureAuthoringSession = (): AuthoringSession => ({
  ownerKey: getStoredSessionOwnerKey(),
  generation: getSessionGeneration(),
});

/**
 * Whether the session that began a write still holds this browser's days and queue. A logout in
 * progress (in this tab or another) already counts as a change: its cleanup may have cleared the
 * days the write would land on.
 */
export const isAuthoringSessionCurrent = (session: AuthoringSession): boolean =>
  !isSessionCleanupPending() &&
  session.ownerKey === getStoredSessionOwnerKey() &&
  session.generation === getSessionGeneration();

/** A write's send checks this before each wait and inside its transaction; a throw stops it. */
export const assertAuthoringSessionCurrent = (session: AuthoringSession): void => {
  if (!isAuthoringSessionCurrent(session))
    throw new Error('La sesión cambió antes de enviar la escritura.');
};

/** Only the public write boundary accepts an uncaptured request. */
export type PublicWriteOptions<T extends { authoringSession: AuthoringSession }> = Omit<
  T,
  'authoringSession'
> &
  Partial<Pick<T, 'authoringSession'>>;
export const authoredOptions = <T extends { authoringSession: AuthoringSession }>(
  options: PublicWriteOptions<T>
) => ({
  ...options,
  authoringSession: options.authoringSession ?? captureAuthoringSession(),
});
