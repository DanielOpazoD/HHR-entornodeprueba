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
