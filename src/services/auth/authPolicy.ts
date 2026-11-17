import type { UserRole } from '@/types/authRoleTypes';
import { normalizeEmail } from '@/services/auth/authShared';
import { getDynamicRoleForEmail } from '@/services/auth/authRoleLookup';
import { getCachedRole, saveRoleToCache } from '@/services/auth/authRoleCache';
import {
  recordAuthOperationalError,
  emitAuthOperationalEvent,
} from '@/services/auth/authOperationalTelemetry';
import { isGeneralLoginRole } from '@/shared/access/roleAccessMatrix';
import { resolveAllowedRoleForEmail } from '@/services/auth/authRoleResolutionController';
export { clearRoleCacheForEmail } from '@/services/auth/authRoleCache';

export interface GeneralLoginAccessResolution {
  allowed: boolean;
  role?: UserRole;
  resolution: 'authorized' | 'unauthorized' | 'unavailable';
}

export interface GeneralLoginAccessOptions {
  allowCachedRole?: boolean;
}

export const resolveGeneralLoginAccessForEmail = async (
  email: string,
  options: GeneralLoginAccessOptions = {}
): Promise<GeneralLoginAccessResolution> => {
  try {
    const cleanEmail = normalizeEmail(email);
    if (options.allowCachedRole) {
      const cachedRole = (await getCachedRole(cleanEmail)) ?? undefined;
      if (isGeneralLoginRole(cachedRole)) {
        return { allowed: true, role: cachedRole, resolution: 'authorized' };
      }
    }

    const { role, source } = await resolveAllowedRoleForEmail(cleanEmail, {
      getDynamicRoleForEmail,
    });

    if (role) {
      void saveRoleToCache(cleanEmail, role);
      return { allowed: true, role, resolution: 'authorized' };
    }

    emitAuthOperationalEvent('resolve_general_login_access', 'unauthorized', {
      code: 'auth_email_not_authorized',
      message: `Email not found in config/roles: ${cleanEmail}`,
      severity: 'warning',
      runtimeState: 'unauthorized',
      userSafeMessage: 'El correo no está autorizado para ingresar.',
      context: {
        email: cleanEmail,
        source,
      },
    });
    return { allowed: false, resolution: 'unauthorized' };
  } catch (error) {
    recordAuthOperationalError('resolve_general_login_access', error, {
      code: 'auth_role_lookup_failed',
      message: 'Error resolving general login access from config/roles.',
      severity: 'warning',
      runtimeState: 'retryable',
      userSafeMessage: 'No se pudo validar el acceso del correo en este momento.',
      context: {
        email: normalizeEmail(email),
      },
    });
    return { allowed: false, resolution: 'unavailable' };
  }
};
