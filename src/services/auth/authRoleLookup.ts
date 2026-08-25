import { httpsCallable } from 'firebase/functions';
import type { UserRole } from '@/types/authRoleTypes';
import { normalizeEmail } from '@/services/auth/authShared';
import { isGeneralLoginRole } from '@/shared/access/roleAccessMatrix';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { createAuthError } from '@/services/auth/authShared';
import { markPerf } from '@/shared/runtime/perfAudit';

type CheckUserRoleCallableData = {
  role?: string | null;
};

export const AUTH_ROLE_LOOKUP_UNAVAILABLE_CODE = 'auth/role-lookup-unavailable';
const RECENT_ROLE_LOOKUP_REUSE_MS = 10_000;

export const resolveCallableRole = (
  response: CheckUserRoleCallableData | null | undefined
): UserRole | null => {
  const role = response?.role ?? undefined;
  if (!isGeneralLoginRole(role)) {
    return null;
  }

  return role;
};

export const createAuthRoleLookupService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
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
    generation: number
  ): Promise<UserRole | null> => {
    try {
      markPerf('auth-role:lookup-start');
      const functions = await functionsRuntime.getFunctions();
      const checkUserRole = httpsCallable<Record<string, never>, CheckUserRoleCallableData>(
        functions,
        'checkUserRole'
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
