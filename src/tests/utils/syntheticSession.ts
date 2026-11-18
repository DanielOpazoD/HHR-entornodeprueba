import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

/**
 * Signs a synthetic person in as the app does: the owner stored for this browser and the
 * generation this document admitted. Tests use the real session, so the guard they exercise is the
 * one production reads, whichever module it is imported from.
 */
export const admitSyntheticSession = (owner: string | null, generation: string | null): void => {
  if (owner) localStorage.setItem(SESSION_OWNER_KEY, owner);
  else localStorage.removeItem(SESSION_OWNER_KEY);
  setSessionGeneration(generation, owner);
};

/** Another tab signs a different person in: the shared owner changes before this document admits it. */
export const replaceStoredSessionOwner = (owner: string): void =>
  localStorage.setItem(SESSION_OWNER_KEY, owner);

export const clearSyntheticSession = (): void => admitSyntheticSession(null, null);
