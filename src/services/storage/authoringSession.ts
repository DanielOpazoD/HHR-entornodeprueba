import {
  getSessionEpoch,
  getSessionGeneration,
  getSessionOwner,
  sessionEpochGuard,
} from './sessionStorageTransition';
import { getStoredSessionOwnerKey, isSessionCleanupPending } from './sessionOwnerKey';

/** The person and session that began a write: whose intent it carries, whatever happens later. */
export interface AuthoringSession {
  ownerKey: string | null;
  generation: string | null;
}

/**
 * The owner is the person this tab admitted, never the shared key another tab may already have
 * replaced: an edit A makes in a census still open after B signed in elsewhere stays A's (kept for
 * A to review on return), never B's. Before any admission it is the browser's owner.
 */
export const captureAuthoringSession = (): AuthoringSession => ({
  ownerKey: getSessionOwner() ?? getStoredSessionOwnerKey(),
  generation: getSessionGeneration(),
});

/**
 * The person this tab may act for: the one it admitted, while the browser still holds them. Null
 * once another tab admitted someone else on the shared key, and null in a document that logged out
 * (it admitted someone and holds no session now) until it admits again: such a tab claims, sends,
 * revives, discards and enqueues nobody's work, and everyone's stays as it is. A document that has
 * admitted nobody yet (start-up) follows the browser's owner, as before admission.
 */
export const getTabOwnerKey = (): string | null => {
  const generation = getSessionGeneration();
  if (generation === null && getSessionEpoch() > 0) return null;
  const browserOwner = getStoredSessionOwnerKey();
  const admitted = getSessionOwner();
  return admitted === null || admitted === browserOwner ? browserOwner : null;
};

/**
 * Whether `ownerKey` is the person this tab may act for (getTabOwnerKey), with no logout cleanup
 * in progress. Every exit of the queue and every write asks this: work kept in someone's name is
 * enqueued, sent, revived or discarded only for them, in a tab that admitted them.
 */
export const isAdmittedOwner = (ownerKey: string | null | undefined): boolean =>
  !isSessionCleanupPending() &&
  (ownerKey ?? null) === getTabOwnerKey() &&
  // A tab that no longer acts for anyone acts for no unowned work either.
  (ownerKey != null || getStoredSessionOwnerKey() === null);

/**
 * Whether the session that began a write still holds this tab, this browser's days and queue. A
 * logout in progress (in this tab or another) already counts as a change: its cleanup may have
 * cleared the days the write would land on.
 */
export const isAuthoringSessionCurrent = (session: AuthoringSession): boolean =>
  isAdmittedOwner(session.ownerKey) && session.generation === getSessionGeneration();

/** One asynchronous operation's view of the session it began in. */
export interface AuthoringSessionGuard {
  /** Captured once, before the first wait; a write carries it and a cache is keyed by it. */
  readonly session: AuthoringSession;
  /** False once the signal aborts or the session changes, even if it later changes back. */
  isCurrent: () => boolean;
  /** Throws the signal's abort, or `message` when the session changed. */
  check: () => void;
}

/**
 * The one way an asynchronous operation asks whether the person who started it is still the one
 * signed in: capture here, then call check() (or isCurrent()) after every wait. Use it whenever the
 * result is written or left stored (IndexedDB, queue, server, browser storage), and for a late read
 * of shared data. A result that is only shown in this tab can use sessionEpochGuard() instead.
 * The epoch is part of it: a logout and a sign-in back under the same person and generation is
 * still a change, even though the captured session looks current again.
 */
export const guardAuthoringSession = ({
  signal,
  message = 'La sesión cambió.',
}: { signal?: AbortSignal; message?: string } = {}): AuthoringSessionGuard => {
  const session = captureAuthoringSession();
  const sameEpoch = sessionEpochGuard();
  const current = () => sameEpoch() && isAuthoringSessionCurrent(session);
  return {
    session,
    isCurrent: () => !signal?.aborted && current(),
    check: () => {
      signal?.throwIfAborted();
      if (!current()) throw new Error(message);
    },
  };
};

/**
 * Key of what is remembered for one person and session, or '' when nobody is admitted. Caches kept
 * in browser storage use it rather than the session epoch, which restarts at every page load.
 * Without an argument it is the scope this tab acts for now: '' once another tab admitted someone
 * else, so a late result is never kept or shown under a person the browser no longer holds.
 */
export const authoringSessionScope = (
  { ownerKey, generation }: AuthoringSession = {
    ownerKey: getTabOwnerKey(),
    generation: getSessionGeneration(),
  }
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
