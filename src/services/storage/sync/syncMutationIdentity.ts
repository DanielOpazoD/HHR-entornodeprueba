const SYNC_CLIENT_ID_STORAGE_KEY = 'hhr_sync_client_id_v1';
const SYNC_TAB_ID_STORAGE_KEY = 'hhr_sync_tab_id_v1';

let fallbackClientId: string | null = null;
let fallbackTabId: string | null = null;
let mutationSequence = 0;

const createRandomToken = (prefix: string): string => {
  const randomId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${randomId}`;
};

const readLocalStorage = (key: string): string | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalStorage = (key: string, value: string): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage can be unavailable in restricted/private contexts; the in-memory
    // fallback still gives a stable identity for this runtime.
  }
};

const readSessionStorage = (key: string): string | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSessionStorage = (key: string, value: string): void => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // See writeLocalStorage.
  }
};

export const getSyncClientId = (): string => {
  const storedClientId = readLocalStorage(SYNC_CLIENT_ID_STORAGE_KEY);
  if (storedClientId) {
    return storedClientId;
  }

  const clientId = fallbackClientId || createRandomToken('client');
  fallbackClientId = clientId;
  writeLocalStorage(SYNC_CLIENT_ID_STORAGE_KEY, clientId);
  return clientId;
};

export const getSyncTabId = (): string => {
  const storedTabId = readSessionStorage(SYNC_TAB_ID_STORAGE_KEY);
  if (storedTabId) {
    return storedTabId;
  }

  const tabId = fallbackTabId || createRandomToken('tab');
  fallbackTabId = tabId;
  writeSessionStorage(SYNC_TAB_ID_STORAGE_KEY, tabId);
  return tabId;
};

export const createSyncMutationId = (): string => {
  mutationSequence += 1;
  return `mutation_${Date.now().toString(36)}_${mutationSequence}_${createRandomToken('op')}`;
};

export const buildSyncMutationIdentity = (): {
  mutationId: string;
  clientId: string;
  tabId: string;
} => ({
  mutationId: createSyncMutationId(),
  clientId: getSyncClientId(),
  tabId: getSyncTabId(),
});

export const resetSyncMutationIdentityForTests = (): void => {
  fallbackClientId = null;
  fallbackTabId = null;
  mutationSequence = 0;
  try {
    localStorage.removeItem(SYNC_CLIENT_ID_STORAGE_KEY);
    sessionStorage.removeItem(SYNC_TAB_ID_STORAGE_KEY);
  } catch {
    // Test helper only.
  }
};
