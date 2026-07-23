const FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
const AUTHENTICATED_SESSION_HINT_KEY = 'hhr_logged_this_session';
const GOOGLE_LOGIN_ATTEMPT_HINT_KEY = 'hhr_google_login_attempt_pending';
const GOOGLE_LOGIN_ATTEMPT_HINT_TTL_MS = 120_000;

const hasWindowStorage = (storage: Storage | undefined): storage is Storage =>
  typeof window !== 'undefined' && typeof storage !== 'undefined';

const storageContainsPrefix = (storage: Storage, prefix: string): boolean => {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
};

export const hasPersistedFirebaseAuthHint = (): boolean => {
  if (
    !hasWindowStorage(typeof localStorage === 'undefined' ? undefined : localStorage) &&
    !hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
  ) {
    return false;
  }

  return (
    (hasWindowStorage(typeof localStorage === 'undefined' ? undefined : localStorage) &&
      storageContainsPrefix(localStorage, FIREBASE_AUTH_STORAGE_PREFIX)) ||
    (hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage) &&
      storageContainsPrefix(sessionStorage, FIREBASE_AUTH_STORAGE_PREFIX))
  );
};

/**
 * Removes persisted Firebase auth entries from web storage. Used on manual
 * logout so a stale `firebase:authUser:*` copy can never re-trigger the
 * authenticated bootstrap chrome (or a ghost re-login) after the user chose
 * to sign out — even if the Firebase signOut call itself failed offline.
 */
export const clearPersistedFirebaseAuthState = (): void => {
  const storages = [
    typeof localStorage === 'undefined' ? undefined : localStorage,
    typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
  ];

  for (const storage of storages) {
    if (!hasWindowStorage(storage)) continue;
    try {
      const staleKeys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(FIREBASE_AUTH_STORAGE_PREFIX)) {
          staleKeys.push(key);
        }
      }
      staleKeys.forEach(key => storage.removeItem(key));
    } catch {
      // Ignore storage errors — this cleanup is best-effort.
    }
  }
};

export const hasRecentAuthenticatedSessionHint = (): boolean => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return false;
  }

  try {
    return sessionStorage.getItem(AUTHENTICATED_SESSION_HINT_KEY) === 'true';
  } catch {
    return false;
  }
};

export const clearRecentAuthenticatedSessionHint = (): void => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return;
  }

  try {
    sessionStorage.removeItem(AUTHENTICATED_SESSION_HINT_KEY);
  } catch {
    // Ignore storage errors
  }
};

export const markGoogleLoginAttemptHint = (): void => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return;
  }

  try {
    sessionStorage.setItem(GOOGLE_LOGIN_ATTEMPT_HINT_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors
  }
};

export const hasRecentGoogleLoginAttemptHint = (): boolean => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return false;
  }

  try {
    const rawValue = sessionStorage.getItem(GOOGLE_LOGIN_ATTEMPT_HINT_KEY);
    if (!rawValue) {
      return false;
    }

    const startedAt = Number(rawValue);
    return Number.isFinite(startedAt) && Date.now() - startedAt <= GOOGLE_LOGIN_ATTEMPT_HINT_TTL_MS;
  } catch {
    return false;
  }
};

export const clearGoogleLoginAttemptHint = (): void => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return;
  }

  try {
    sessionStorage.removeItem(GOOGLE_LOGIN_ATTEMPT_HINT_KEY);
  } catch {
    // Ignore storage errors
  }
};
