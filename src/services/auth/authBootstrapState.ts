import { AUTH_BOOTSTRAP_PENDING_TTL_MS } from '@/services/auth/authBootstrapBudgets';

// Per-tab on purpose: the pending-redirect flag describes THIS tab's OAuth
// round trip (sessionStorage survives the same-tab navigation to Google and
// back). The v1 flag lived in localStorage and leaked "redirect pending" into
// every other tab, producing longer bootstrap budgets and confusing errors in
// tabs that never started a login.
const AUTH_BOOTSTRAP_PENDING_KEY = 'hhr_auth_bootstrap_pending_v1';

type AuthBootstrapState = {
  startedAt: number;
  mode: 'redirect';
  returnTo: string | null;
};

const resolveCurrentReturnTo = (): string | null => {
  if (typeof window === 'undefined') return null;
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

// Storage getters themselves can throw when the browser blocks storage access,
// so every access below is guarded: an unavailable store means "no pending
// redirect" instead of an exception on the path that starts the Google flow.
const resolveStorage = (kind: 'local' | 'session'): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return (kind === 'local' ? window.localStorage : window.sessionStorage) ?? null;
  } catch {
    return null;
  }
};

const clearLegacySharedPendingState = (): void => {
  try {
    resolveStorage('local')?.removeItem(AUTH_BOOTSTRAP_PENDING_KEY);
  } catch {
    // Best-effort cleanup of the legacy cross-tab copy.
  }
};

const readState = (): AuthBootstrapState | null => {
  clearLegacySharedPendingState();

  try {
    const sessionStore = resolveStorage('session');
    if (!sessionStore) return null;
    const raw = sessionStore.getItem(AUTH_BOOTSTRAP_PENDING_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AuthBootstrapState>;
    if (parsed.mode !== 'redirect' || typeof parsed.startedAt !== 'number') {
      return null;
    }

    if (Date.now() - parsed.startedAt > AUTH_BOOTSTRAP_PENDING_TTL_MS) {
      sessionStore.removeItem(AUTH_BOOTSTRAP_PENDING_KEY);
      return null;
    }

    return {
      startedAt: parsed.startedAt,
      mode: parsed.mode,
      returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : null,
    };
  } catch {
    return null;
  }
};

export const markAuthBootstrapPending = (
  mode: 'redirect' = 'redirect',
  returnTo: string | null = resolveCurrentReturnTo()
): void => {
  const payload: AuthBootstrapState = {
    startedAt: Date.now(),
    mode,
    returnTo,
  };
  try {
    resolveStorage('session')?.setItem(AUTH_BOOTSTRAP_PENDING_KEY, JSON.stringify(payload));
  } catch {
    // A blocked/full store must not abort the redirect sign-in it precedes.
  }
};

export const isAuthBootstrapPending = (): boolean => Boolean(readState());

export const getAuthBootstrapPendingAgeMs = (): number => {
  const state = readState();
  if (!state) return 0;
  return Math.max(0, Date.now() - state.startedAt);
};

export const restoreAuthBootstrapReturnTo = (): void => {
  const state = readState();
  if (!state?.returnTo || typeof window === 'undefined') return;

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === state.returnTo) return;

  window.history.replaceState(window.history.state, '', state.returnTo);
};

export const clearAuthBootstrapPending = (): void => {
  clearLegacySharedPendingState();
  try {
    resolveStorage('session')?.removeItem(AUTH_BOOTSTRAP_PENDING_KEY);
  } catch {
    // Best-effort: a blocked store simply has nothing to clear.
  }
};
