const RECENT_MANUAL_LOGOUT_KEY = 'hhr_recent_manual_logout_v1';
const RECENT_MANUAL_LOGOUT_TTL_MS = 120_000;

type ManualLogoutState = {
  reason: 'manual';
  at: number;
};

const resolveSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const readManualLogoutState = (): ManualLogoutState | null => {
  try {
    const storage = resolveSessionStorage();
    if (!storage) return null;
    const raw = storage.getItem(RECENT_MANUAL_LOGOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManualLogoutState>;
    if (parsed.reason !== 'manual' || typeof parsed.at !== 'number') {
      storage.removeItem(RECENT_MANUAL_LOGOUT_KEY);
      return null;
    }

    if (Date.now() - parsed.at > RECENT_MANUAL_LOGOUT_TTL_MS) {
      storage.removeItem(RECENT_MANUAL_LOGOUT_KEY);
      return null;
    }

    return { reason: 'manual', at: parsed.at };
  } catch {
    return null;
  }
};

export const markRecentManualLogout = (): void => {
  const payload: ManualLogoutState = {
    reason: 'manual',
    at: Date.now(),
  };
  try {
    resolveSessionStorage()?.setItem(RECENT_MANUAL_LOGOUT_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort hint; a blocked store must never interrupt logout.
  }
};

export const hasRecentManualLogout = (): boolean => Boolean(readManualLogoutState());

export const clearRecentManualLogout = (): void => {
  try {
    resolveSessionStorage()?.removeItem(RECENT_MANUAL_LOGOUT_KEY);
  } catch {
    // Best-effort cleanup.
  }
};

/** A sign-in never waits longer than this for a logout of the same tab (its steps are bounded). */
const PENDING_LOGOUT_MAX_WAIT_MS = 5_000;
let pendingLogout: Promise<void> | null = null;

/**
 * Marks a logout of this tab still under way: audit, Firebase sign-out and storage cleanup. A
 * sign-in started meanwhile would read the leaving session (user, generation) and be refused when
 * the cleanup changes them, or send that session's token (revoked after a password change).
 * Returns the function that marks the logout done; calling it again is harmless.
 */
export const beginPendingLogout = (): (() => void) => {
  let finish: () => void = () => undefined;
  const done = new Promise<void>(resolve => {
    finish = resolve;
  });
  pendingLogout = done;
  return () => {
    finish();
    if (pendingLogout === done) pendingLogout = null;
  };
};

/** Resolves once this tab's logout, if any, has finished. */
export const waitForPendingLogout = async (): Promise<void> => {
  if (!pendingLogout) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    pendingLogout,
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, PENDING_LOGOUT_MAX_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
};
