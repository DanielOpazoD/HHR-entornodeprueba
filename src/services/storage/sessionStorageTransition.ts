// The browser lock covers shared IndexedDB/localStorage; the promise queue is
// also needed in a single document (and in runtimes without Web Locks).
let pending: Promise<unknown> = Promise.resolve();
export const SESSION_GENERATION_KEY = 'hhr_session_generation_v1';
let admittedGeneration: string | null = null;
let admittedOwner: string | null = null;

/** Owner admitted by this document, never the shared key another tab can replace. */
export const getSessionOwner = (): string | null => admittedOwner;

export const getSessionGeneration = (): string | null => admittedGeneration;
export const getLogoutGeneration = (): string | null => {
  // A bootstrap document has not admitted an owner yet. Shared storage may
  // already belong to a replacement in another tab; it is not local proof.
  return admittedGeneration;
};
type SessionChangeListener = (generation: string | null) => void;
const sessionChangeListeners = new Set<SessionChangeListener>();
let sessionEpoch = 0;

/** Admissions and logouts this document has seen: the key for anything remembered per person. */
export const getSessionEpoch = (): number => sessionEpoch;

/**
 * The one place to learn that the Eloísa session changed. Listeners run synchronously, before the
 * window message the extension bridge reads, so nothing remembered for the previous person
 * outlives the change by even a tick. Nobody else listens to that message.
 */
export const onSessionChange = (listener: SessionChangeListener): (() => void) => {
  sessionChangeListeners.add(listener);
  return () => {
    sessionChangeListeners.delete(listener);
  };
};

export const setSessionGeneration = (
  generation: string | null,
  owner: string | null = null
): void => {
  if (admittedGeneration === generation && admittedOwner === owner) return;
  admittedOwner = generation ? owner : null;
  admittedGeneration = generation;
  sessionEpoch += 1;
  for (const listener of sessionChangeListeners) {
    // A listener that moved the session on again has already notified everyone with the newer
    // generation; the older one must not reach the remaining listeners afterwards.
    if (admittedGeneration !== generation) break;
    try {
      listener(generation);
    } catch {
      // A listener that fails must not stop the others, nor the admission itself.
    }
  }
  if (typeof window !== 'undefined') {
    window.postMessage({ type: 'HHR_RAYEN_SESSION_CHANGED' }, window.location.origin);
  }
};

export const runSessionStorageTransition = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pending.then(() => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('hhr-session-storage-transition', operation);
    }
    return operation();
  });
  pending = result.catch(() => undefined);
  return result;
};
