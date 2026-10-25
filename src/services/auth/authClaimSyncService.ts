import type { User } from 'firebase/auth';
import type { UserRole } from '@/types/authRoleTypes';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { isGeneralLoginRole } from '@/shared/access/roleAccessMatrix';
import { authClaimSyncLogger } from '@/services/auth/authLoggers';
import { emitAuthOperationalEvent } from '@/services/auth/authOperationalTelemetry';

export type AuthClaimSyncStatus = 'idle' | 'verified' | 'pending' | 'failed';

export interface AuthClaimSyncSnapshot {
  status: AuthClaimSyncStatus;
  lastAttemptAt: number | null;
  lastResolvedRole: UserRole | null;
  lastErrorMessage?: string;
}

let authClaimSyncSnapshot: AuthClaimSyncSnapshot = {
  status: 'idle',
  lastAttemptAt: null,
  lastResolvedRole: null,
};

const setAuthClaimSyncSnapshot = (patch: Partial<AuthClaimSyncSnapshot>) => {
  authClaimSyncSnapshot = {
    ...authClaimSyncSnapshot,
    ...patch,
  };
};

export const getAuthClaimSyncSnapshot = (): AuthClaimSyncSnapshot => authClaimSyncSnapshot;

export const resetAuthClaimSyncSnapshot = (): void => {
  authClaimSyncSnapshot = {
    status: 'idle',
    lastAttemptAt: null,
    lastResolvedRole: null,
  };
};

const resolveTokenRole = async (firebaseUser: User): Promise<string | null> => {
  const token = await firebaseUser.getIdTokenResult();
  return typeof token.claims.role === 'string' ? token.claims.role : null;
};

export const resolveUserRoleClaim = async (firebaseUser: User): Promise<UserRole | null> => {
  // Managed accounts require current server state; a cached role cannot prove activation/revocation.
  if (firebaseUser.uid.startsWith('hhrn_')) return null;
  const tokenRole = (await resolveTokenRole(firebaseUser)) ?? undefined;
  return isGeneralLoginRole(tokenRole) ? tokenRole : null;
};

export const createAuthClaimSyncService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => ({
  syncCurrentUserRoleClaim: async (): Promise<{ role: UserRole | null }> => {
    const functions = await functionsRuntime.getFunctions();
    const { httpsCallable } = await import('firebase/functions');
    const syncUserRoleClaim = httpsCallable<undefined, { role?: UserRole | null }>(
      functions,
      'syncCurrentUserRoleClaim'
    );
    const result = await syncUserRoleClaim();
    return {
      role: result.data?.role ?? null,
    };
  },
});

const authClaimSyncService = createAuthClaimSyncService();
export const syncCurrentUserRoleClaim = authClaimSyncService.syncCurrentUserRoleClaim;

export const ensureUserRoleClaim = async (
  firebaseUser: User,
  resolvedRole: UserRole
): Promise<void> => {
  if (firebaseUser.uid.startsWith('hhrn_')) return;
  const tokenRole = await resolveUserRoleClaim(firebaseUser);
  if (tokenRole === resolvedRole) {
    setAuthClaimSyncSnapshot({
      status: 'verified',
      lastAttemptAt: Date.now(),
      lastResolvedRole: resolvedRole,
      lastErrorMessage: undefined,
    });
    return;
  }

  setAuthClaimSyncSnapshot({
    status: 'pending',
    lastAttemptAt: Date.now(),
    lastResolvedRole: resolvedRole,
    lastErrorMessage: undefined,
  });

  try {
    await syncCurrentUserRoleClaim();
    await firebaseUser.getIdToken(true);
    setAuthClaimSyncSnapshot({
      status: 'verified',
      lastAttemptAt: Date.now(),
      lastResolvedRole: resolvedRole,
      lastErrorMessage: undefined,
    });
  } catch (error) {
    authClaimSyncLogger.warn('Failed to sync current user role claim', error);
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Claim sync failed';
    setAuthClaimSyncSnapshot({
      status: 'failed',
      lastAttemptAt: Date.now(),
      lastResolvedRole: resolvedRole,
      lastErrorMessage: message,
    });
    emitAuthOperationalEvent('auth_claim_sync_failed', 'degraded', {
      code: 'auth_claim_sync_failed',
      message: 'Failed to sync the current user role claim.',
      severity: 'warning',
      userSafeMessage:
        'La sesión quedó autorizada, pero el claim de rol no se pudo sincronizar todavía.',
      context: {
        resolvedRole,
        tokenRole,
        userUid: firebaseUser.uid,
        errorMessage: message,
      },
    });
  }
};
