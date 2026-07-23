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
  // share the in-flight callable so one sign-in never fires checkUserRole twice.
  const inFlightLookups = new Map<string, Promise<UserRole | null>>();

  const runRoleLookup = async (cleanEmail: string): Promise<UserRole | null> => {
    try {
      markPerf('auth-role:lookup-start');
      const functions = await functionsRuntime.getFunctions();
      const checkUserRole = httpsCallable<Record<string, never>, CheckUserRoleCallableData>(
        functions,
        'checkUserRole'
      );
      const response = await checkUserRole({});
      const role = resolveCallableRole(response.data);
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
      inFlightLookups.delete(cleanEmail);
    }
  };

  return {
    getDynamicRoleForEmail: async (email: string): Promise<UserRole | null> => {
      const cleanEmail = normalizeEmail(email);
      if (!cleanEmail) return null;

      const existingLookup = inFlightLookups.get(cleanEmail);
      if (existingLookup) {
        return existingLookup;
      }

      const lookup = runRoleLookup(cleanEmail);
      inFlightLookups.set(cleanEmail, lookup);
      return lookup;
    },
  };
};

const authRoleLookupService = createAuthRoleLookupService();
export const getDynamicRoleForEmail = authRoleLookupService.getDynamicRoleForEmail;
