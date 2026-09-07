import { signOut as firebaseSignOut, User } from 'firebase/auth';
import type { AuthUser, UserRole } from '@/types/authRoleTypes';
import { resolveGeneralLoginAccessForEmail } from '@/services/auth/authPolicy';
import { createAuthError, toAuthUser } from '@/services/auth/authShared';
import { recordAuthOperationalError } from '@/services/auth/authOperationalTelemetry';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { resolveUserRoleClaim } from '@/services/auth/authClaimSyncService';

const STANDARD_UNAUTHORIZED_MESSAGE =
  'Acceso no autorizado. Tu correo no tiene un rol vigente en Gestión de Roles.';
const ROLE_VALIDATION_UNAVAILABLE_MESSAGE =
  'No se pudo validar tu acceso en este momento. Intenta nuevamente en unos segundos.';

interface AuthRuntimeOptions {
  authRuntime?: AuthRuntime;
  isCurrent?: () => boolean;
}

const resolveAuthRuntime = ({ authRuntime }: AuthRuntimeOptions = {}): AuthRuntime =>
  authRuntime ?? defaultAuthRuntime;

const rejectUnauthorizedUser = async (
  message: string,
  authRuntime: AuthRuntime,
  isCurrent?: () => boolean
): Promise<never> => {
  await authRuntime.ready;
  if (isCurrent && !isCurrent()) {
    throw createAuthError('auth/cancelled-popup-request', 'Inicio cancelado.');
  }
  await firebaseSignOut(authRuntime.auth);
  throw new Error(message);
};

export const authorizeFirebaseUser = async (
  user: User,
  options?: AuthRuntimeOptions
): Promise<AuthUser> => {
  const authRuntime = resolveAuthRuntime(options);
  const { allowed, role, resolution } = await resolveGeneralLoginAccessForEmail(user.email || '');
  if (options?.isCurrent && !options.isCurrent()) {
    throw createAuthError('auth/cancelled-popup-request', 'Inicio cancelado.');
  }
  if (allowed && role) {
    return toAuthUser(user, role);
  }

  if (resolution === 'unavailable') {
    const tokenRole = await resolveUserRoleClaim(user);
    if (options?.isCurrent && !options.isCurrent()) {
      throw createAuthError('auth/cancelled-popup-request', 'Inicio cancelado.');
    }
    if (tokenRole) {
      return toAuthUser(user, tokenRole);
    }

    throw createAuthError('auth/role-validation-unavailable', ROLE_VALIDATION_UNAVAILABLE_MESSAGE);
  }

  if (!allowed) {
    return rejectUnauthorizedUser(STANDARD_UNAUTHORIZED_MESSAGE, authRuntime, options?.isCurrent);
  }
  throw createAuthError('auth/role-validation-unavailable', ROLE_VALIDATION_UNAVAILABLE_MESSAGE);
};

export const authorizeCurrentFirebaseUser = async (
  options?: AuthRuntimeOptions
): Promise<AuthUser | null> => {
  const authRuntime = resolveAuthRuntime(options);
  await authRuntime.ready;
  const existingUser = authRuntime.getCurrentUser();
  if (!existingUser || existingUser.isAnonymous) {
    return null;
  }

  try {
    return await authorizeFirebaseUser(existingUser, { authRuntime });
  } catch (error) {
    const err = error as { message?: string };
    if (err.message?.includes('no autorizado')) {
      return null;
    }
    throw error;
  }
};

export const resolveFirebaseUserRole = async (firebaseUser: User): Promise<UserRole | null> => {
  return resolveFirebaseUserRoleFromPolicy(firebaseUser);
};

export const resolveFirebaseUserRoleForBootstrap = async (
  firebaseUser: User
): Promise<UserRole | null> => {
  return resolveFirebaseUserRoleFromPolicy(firebaseUser, { allowCachedRole: true });
};

const resolveFirebaseUserRoleFromPolicy = async (
  firebaseUser: User,
  options: { allowCachedRole?: boolean } = {}
): Promise<UserRole | null> => {
  try {
    const loginAccess = options.allowCachedRole
      ? await resolveGeneralLoginAccessForEmail(firebaseUser.email || '', {
          allowCachedRole: true,
        })
      : await resolveGeneralLoginAccessForEmail(firebaseUser.email || '');
    if (loginAccess.allowed && loginAccess.role) {
      return loginAccess.role;
    }

    if (loginAccess.resolution === 'unavailable') {
      const tokenRole = await resolveUserRoleClaim(firebaseUser);
      if (tokenRole) {
        return tokenRole;
      }

      throw createAuthError(
        'auth/role-validation-unavailable',
        ROLE_VALIDATION_UNAVAILABLE_MESSAGE
      );
    }

    return null;
  } catch (error) {
    recordAuthOperationalError('resolve_firebase_user_role', error, {
      code: 'auth_token_role_resolution_failed',
      message: 'Error resolving role from config/roles.',
      severity: 'warning',
      runtimeState: 'retryable',
      userSafeMessage: 'No se pudo resolver el rol desde la sesión actual.',
      context: {
        email: firebaseUser.email || null,
      },
    });
    throw error;
  }
};
