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
  isAdmittedOwner(session.ownerKey) && session.generation === getSessionGeneration();

/**
 * Whether `ownerKey` is the person this browser holds now, with no logout cleanup in progress.
 * Work kept in someone's name without a generation (a queued task) is revived only for them.
 */
export const isAdmittedOwner = (ownerKey: string | null | undefined): boolean =>
  !isSessionCleanupPending() && (ownerKey ?? null) === getStoredSessionOwnerKey();

/** One asynchronous operation's view of the session it began in. */
export interface AuthoringSessionGuard {
  /** Captured once, before the first wait; a write carries it and a cache is keyed by it. */
  readonly session: AuthoringSession;
  /** False once the signal aborts or the session changes. */
  isCurrent: () => boolean;
  /** Throws the signal's abort, or `message` when the session changed. */
  check: () => void;
}

/**
 * The one way an asynchronous operation asks whether the person who started it is still the one
 * signed in: capture here, then call check() (or isCurrent()) after every wait. Use it whenever the
 * result is written or left stored (IndexedDB, queue, server, browser storage), and for a late read
 * of shared data. A result that is only shown in this tab can use sessionEpochGuard() instead.
 */
export const guardAuthoringSession = ({
  signal,
  message = 'La sesión cambió.',
}: { signal?: AbortSignal; message?: string } = {}): AuthoringSessionGuard => {
  const session = captureAuthoringSession();
  return {
    session,
    isCurrent: () => !signal?.aborted && isAuthoringSessionCurrent(session),
    check: () => {
      signal?.throwIfAborted();
      if (!isAuthoringSessionCurrent(session)) throw new Error(message);
    },
  };
};

/**
 * Key of what is remembered for one person and session, or '' when nobody is admitted. Caches kept
 * in browser storage use it rather than the session epoch, which restarts at every page load.
 */
export const authoringSessionScope = (
  { ownerKey, generation }: AuthoringSession = captureAuthoringSession()
): string => (ownerKey && generation ? `${ownerKey}:${generation}` : '');

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
