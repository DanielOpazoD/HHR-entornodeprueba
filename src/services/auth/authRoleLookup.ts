import type { UserRole } from '@/types/authRoleTypes';
import { normalizeEmail } from '@/services/auth/authShared';
import { isGeneralLoginRole } from '@/shared/access/roleAccessMatrix';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { createAuthError } from '@/services/auth/authShared';
import { AUTH_BOOTSTRAP_TIMEOUTS_MS } from '@/services/auth/authBootstrapBudgets';
import { markPerf } from '@/shared/runtime/perfAudit';

type CheckUserRoleCallableData = {
  role?: string | null;
};

export const AUTH_ROLE_LOOKUP_UNAVAILABLE_CODE = 'auth/role-lookup-unavailable';
export const AUTH_ROLE_LOOKUP_TIMEOUT_MS = AUTH_BOOTSTRAP_TIMEOUTS_MS.default;
const RECENT_ROLE_LOOKUP_REUSE_MS = 10_000;
/** A role service that does not answer usually does on the next try: a cold start or a waking tab. */
const ROLE_LOOKUP_RETRY_DELAYS_MS = [1_000, 3_000];

export const resolveCallableRole = (
  response: CheckUserRoleCallableData | null | undefined
): UserRole | null => {
  const role = response?.role ?? undefined;
  if (!isGeneralLoginRole(role)) {
    return null;
  }

  return role;
};

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const createAuthRoleLookupService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime,
  retryDelaysMs: readonly number[] = ROLE_LOOKUP_RETRY_DELAYS_MS
) => {
  // Login and the auth-state observer can request the same role concurrently;
  // share the in-flight callable and its freshly settled result so one sign-in
  // never fires checkUserRole twice when Firebase resolves the observer before
  // the popup promise settles.
  const inFlightLookups = new Map<
    string,
    { generation: number; lookup: Promise<UserRole | null> }
  >();
  const recentLookups = new Map<string, { role: UserRole | null; expiresAt: number }>();
  let lookupGeneration = 0;

  const runRoleLookup = async (
    cleanEmail: string,
    generation: number,
    attempt = 0
  ): Promise<UserRole | null> => {
    try {
      markPerf('auth-role:lookup-start');
      const functions = await functionsRuntime.getFunctions();
      const { httpsCallable } = await import('firebase/functions');
      const checkUserRole = httpsCallable<Record<string, never>, CheckUserRoleCallableData>(
        functions,
        'checkUserRole',
        { timeout: AUTH_ROLE_LOOKUP_TIMEOUT_MS }
      );
      const response = await checkUserRole({});
      const role = resolveCallableRole(response.data);
      if (generation === lookupGeneration) {
        recentLookups.set(cleanEmail, {
          role,
          expiresAt: Date.now() + RECENT_ROLE_LOOKUP_REUSE_MS,
        });
      }
      markPerf('auth-role:lookup-done', role ?? 'none');
      return role;
    } catch (error) {
      markPerf('auth-role:lookup-error');
      // A server/identity denial is authoritative, not an offline fallback opportunity.
      const code = (error as { code?: string } | null)?.code;
      if (
        code &&
        [
          'functions/permission-denied',
          'functions/unauthenticated',
          'auth/user-disabled',
          'auth/user-token-expired',
          'auth/invalid-user-token',
        ].includes(code)
      ) {
        return null;
      }
      const delayMs = retryDelaysMs[attempt];
      // Offline, a retry cannot answer; a cleared generation means the session moved on.
      if (
        delayMs !== undefined &&
        globalThis.navigator?.onLine !== false &&
        generation === lookupGeneration
      ) {
        await wait(delayMs);
        return runRoleLookup(cleanEmail, generation, attempt + 1);
      }
      throw createAuthError(
        AUTH_ROLE_LOOKUP_UNAVAILABLE_CODE,
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo consultar el rol actual del usuario.'
      );
    } finally {
      if (inFlightLookups.get(cleanEmail)?.generation === generation) {
        inFlightLookups.delete(cleanEmail);
      }
    }
  };

  return {
    clearRecentLookups: (): void => {
      lookupGeneration += 1;
      recentLookups.clear();
      inFlightLookups.clear();
    },
    getDynamicRoleForEmail: async (email: string): Promise<UserRole | null> => {
      const cleanEmail = normalizeEmail(email);
      if (!cleanEmail) return null;

      const recentLookup = recentLookups.get(cleanEmail);
      if (recentLookup && recentLookup.expiresAt > Date.now()) {
        return recentLookup.role;
      }
      recentLookups.delete(cleanEmail);

      const existingLookup = inFlightLookups.get(cleanEmail);
      if (existingLookup) {
        return existingLookup.lookup;
      }

      const generation = lookupGeneration;
      const lookup = runRoleLookup(cleanEmail, generation);
      inFlightLookups.set(cleanEmail, { generation, lookup });
      return lookup;
    },
  };
};

const authRoleLookupService = createAuthRoleLookupService();
export const getDynamicRoleForEmail = authRoleLookupService.getDynamicRoleForEmail;
export const clearRecentAuthRoleLookups = authRoleLookupService.clearRecentLookups;
