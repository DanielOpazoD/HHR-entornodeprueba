import { ensureUserRoleClaim } from '@/services/auth/authClaimSyncService';
import { resolveFirebaseUserRole } from '@/services/auth/authAccessResolution';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';

export type FirestoreWriteOperation = 'save' | 'partialUpdate' | 'delete';

export const logFirestoreWriteRetry = (
  operation: FirestoreWriteOperation,
  date: string,
  attempt: number,
  error: unknown
): void => {
  firestoreWriteLogger.warn(`Firestore write retry: ${operation}`, {
    attempt,
    date,
    error,
  });
};

export const logFirestoreWriteError = (
  operation: FirestoreWriteOperation | 'moveToTrash',
  date: string,
  error: unknown
): void => {
  firestoreWriteLogger.error(`Firestore write failed: ${operation}`, {
    date,
    error,
  });
};

export const isPermissionDeniedError = (error: unknown): boolean => {
  const code = String((error as { code?: unknown })?.code || '').toLowerCase();
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();

  return (
    code.includes('permission-denied') || message.includes('missing or insufficient permissions')
  );
};

export const tryRefreshCurrentUserRoleClaim = async (date: string): Promise<boolean> => {
  try {
    await defaultAuthRuntime.ready;
    const firebaseUser = defaultAuthRuntime.getCurrentUser();
    if (!firebaseUser || firebaseUser.isAnonymous) {
      return false;
    }

    const resolvedRole = await resolveFirebaseUserRole(firebaseUser);
    if (!resolvedRole) {
      return false;
    }

    await ensureUserRoleClaim(firebaseUser, resolvedRole);
    firestoreWriteLogger.warn('Firestore write auth refresh succeeded', {
      date,
      resolvedRole,
      uid: firebaseUser.uid,
    });
    return true;
  } catch (error) {
    firestoreWriteLogger.warn('Firestore write auth refresh failed', {
      date,
      error,
    });
    return false;
  }
};
