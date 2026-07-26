import { safeJsonParse } from '@/utils/jsonUtils';

const GOOGLE_LOGIN_LOCK_KEY = 'hhr_google_login_lock_v1';
const GOOGLE_LOGIN_LOCK_TTL_MS = 30_000;
const GOOGLE_LOGIN_TAB_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}`;

type GoogleLoginLockPayload = {
  owner: string;
  timestamp: number;
};

const readGoogleLoginLock = (): GoogleLoginLockPayload | null => {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const raw = window.localStorage.getItem(GOOGLE_LOGIN_LOCK_KEY);
  const parsed = safeJsonParse<GoogleLoginLockPayload | null>(raw, null);
  if (!parsed || !parsed.owner || !parsed.timestamp) return null;
  return parsed;
};

const isGoogleLoginLockActive = (payload: GoogleLoginLockPayload | null): boolean =>
  Boolean(payload && Date.now() - payload.timestamp < GOOGLE_LOGIN_LOCK_TTL_MS);

export const getGoogleLoginLockStatus = (): {
  active: boolean;
  ownedByCurrentTab: boolean;
  remainingMs: number;
} => {
  const lock = readGoogleLoginLock();
  if (!lock) {
    return { active: false, ownedByCurrentTab: false, remainingMs: 0 };
  }

  const ageMs = Date.now() - lock.timestamp;
  const remainingMs = Math.max(0, GOOGLE_LOGIN_LOCK_TTL_MS - ageMs);
  const active = remainingMs > 0;
  return {
    active,
    ownedByCurrentTab: lock.owner === GOOGLE_LOGIN_TAB_ID,
    remainingMs,
  };
};

export const acquireGoogleLoginLock = (): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) return true;

  const currentLock = readGoogleLoginLock();
  if (isGoogleLoginLockActive(currentLock) && currentLock?.owner !== GOOGLE_LOGIN_TAB_ID) {
    return false;
  }

  const nextLock: GoogleLoginLockPayload = {
    owner: GOOGLE_LOGIN_TAB_ID,
    timestamp: Date.now(),
  };
  window.localStorage.setItem(GOOGLE_LOGIN_LOCK_KEY, JSON.stringify(nextLock));

  const confirmed = readGoogleLoginLock();
  return confirmed?.owner === GOOGLE_LOGIN_TAB_ID;
};

export const refreshGoogleLoginLock = (): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const currentLock = readGoogleLoginLock();
  if (!currentLock || currentLock.owner !== GOOGLE_LOGIN_TAB_ID) return;

  window.localStorage.setItem(
    GOOGLE_LOGIN_LOCK_KEY,
    JSON.stringify({
      owner: GOOGLE_LOGIN_TAB_ID,
      timestamp: Date.now(),
    } satisfies GoogleLoginLockPayload)
  );
};

export const startGoogleLoginLockHeartbeat = (intervalMs: number = 5_000): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  const timer = window.setInterval(() => {
    refreshGoogleLoginLock();
  }, intervalMs);

  return () => {
    window.clearInterval(timer);
  };
};

export const releaseGoogleLoginLock = (): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const currentLock = readGoogleLoginLock();
  if (currentLock?.owner === GOOGLE_LOGIN_TAB_ID) {
    window.localStorage.removeItem(GOOGLE_LOGIN_LOCK_KEY);
  }
};
