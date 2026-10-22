import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';

import type { AuthUser, UserRole } from '@/types/authRoleTypes';
import { resolveGeneralLoginAccessForEmail } from '@/services/auth/authPolicy';
import { toAuthUser } from '@/services/auth/authShared';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { waitForPendingLogout } from '@/services/auth/authLogoutState';

interface AuthRuntimeOptions {
  authRuntime?: AuthRuntime;
}

const resolveAuthRuntime = ({ authRuntime }: AuthRuntimeOptions = {}): AuthRuntime =>
  authRuntime ?? defaultAuthRuntime;

const EMAIL_SIGN_IN_ERRORS: Record<string, string> = {
  'auth/user-not-found': 'Usuario no encontrado',
  'auth/wrong-password': 'Contraseña incorrecta',
  'auth/invalid-email': 'Email inválido',
  'auth/user-disabled': 'Usuario deshabilitado',
  'auth/too-many-requests': 'Demasiados intentos. Intente más tarde.',
  'auth/invalid-credential': 'Credenciales inválidas',
};

const CREATE_USER_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': 'Este email ya está registrado',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
  'auth/invalid-email': 'Email inválido',
};

const toCredentialErrorMessage = (
  error: unknown,
  fallbackMessage: string,
  errorMap: Record<string, string>
): string => {
  const authError = error as { code?: string };
  return authError.code ? errorMap[authError.code] || fallbackMessage : fallbackMessage;
};

export const signIn = async (
  email: string,
  password: string,
  options?: AuthRuntimeOptions
): Promise<AuthUser> => {
  const authRuntime = resolveAuthRuntime(options);
  try {
    await authRuntime.ready;
    // Signing in while a logout is still under way would be undone by its sign-out.
    await waitForPendingLogout();
    const result = await signInWithEmailAndPassword(authRuntime.auth, email, password);

    const { allowed, role } = await resolveGeneralLoginAccessForEmail(result.user.email || '');
    if (!allowed) {
      await firebaseSignOut(authRuntime.auth);
      throw new Error(
        'Acceso no autorizado. Tu correo no tiene un rol vigente en Gestión de Roles.'
      );
    }

    return toAuthUser(result.user, role);
  } catch (error: unknown) {
    const authError = error as { message?: string };
    if (authError.message?.includes('no autorizado')) {
      throw error;
    }

    throw new Error(
      toCredentialErrorMessage(error, 'Error de autenticación', EMAIL_SIGN_IN_ERRORS)
    );
  }
};

export const createUser = async (
  email: string,
  password: string,
  options?: AuthRuntimeOptions
): Promise<AuthUser> => {
  const authRuntime = resolveAuthRuntime(options);
  try {
    await authRuntime.ready;
    const result = await createUserWithEmailAndPassword(authRuntime.auth, email, password);
    return toAuthUser(result.user);
  } catch (error: unknown) {
    throw new Error(toCredentialErrorMessage(error, 'Error al crear usuario', CREATE_USER_ERRORS));
  }
};

export type { UserRole };
