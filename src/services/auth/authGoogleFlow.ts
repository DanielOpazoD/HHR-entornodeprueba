import { signInWithPopup } from 'firebase/auth';

import type { AuthUser } from '@/types/authRoleTypes';
import {
  acquireGoogleLoginLock,
  getGoogleLoginLockStatus,
  releaseGoogleLoginLock,
  startGoogleLoginLockHeartbeat,
} from '@/services/auth/googleLoginLock';
import { createAuthError, googleProvider } from '@/services/auth/authShared';
import {
  isPopupOpenFailureAuthError,
  isPopupRecoverableAuthError,
  toGoogleAuthError,
} from '@/services/auth/authErrorPolicy';
import {
  authorizeCurrentFirebaseUser,
  authorizeFirebaseUser,
} from '@/services/auth/authAccessResolution';
import {
  emitAuthOperationalEvent,
  recordAuthOperationalError,
} from '@/services/auth/authOperationalTelemetry';
import { signInWithGoogleRedirect } from '@/services/auth/authFallback';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

// Budget for the user to finish the whole Google flow inside the popup
// (account picker + password + 2FA can easily exceed 30s on shared hospital
// computers). Firebase keeps the popup promise pending far longer than this.
const GOOGLE_POPUP_AUTH_TIMEOUT_MS = 120_000;

interface AuthRuntimeOptions {
  authRuntime?: AuthRuntime;
}

const resolveAuthRuntime = ({ authRuntime }: AuthRuntimeOptions = {}): AuthRuntime =>
  authRuntime ?? defaultAuthRuntime;

/**
 * Fire-and-forget warm-up for the sign-in critical path: resolves the Firebase
 * auth runtime and loads/initializes the Functions client so the post-popup
 * role lookup (checkUserRole) does not pay the dynamic-import cost.
 */
export const warmGoogleSignInRuntime = (options?: AuthRuntimeOptions): void => {
  void resolveAuthRuntime(options).ready.catch(() => {});
  void defaultFunctionsRuntime.getFunctions().catch(() => {});
};

const waitForE2EPopupDelay = async (): Promise<void> => {
  const { consumeE2EPopupDelayMs } = await import('@/services/auth/authE2EPopupRuntime');
  const e2ePopupDelayMs = consumeE2EPopupDelayMs();
  if (e2ePopupDelayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, e2ePopupDelayMs));
  }
};

const resolveE2EPopupUser = async (): Promise<AuthUser | null> => {
  const { consumeE2EPopupErrorCode, consumeE2EPopupMockUser } =
    await import('@/services/auth/authE2EPopupRuntime');
  const e2ePopupErrorCode = consumeE2EPopupErrorCode();
  if (e2ePopupErrorCode) {
    throw createAuthError(e2ePopupErrorCode, `E2E popup error: ${e2ePopupErrorCode}`);
  }

  return consumeE2EPopupMockUser();
};

const signInWithPopupTimeout = async (
  authRuntime: AuthRuntime
): ReturnType<typeof signInWithPopup> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        createAuthError(
          'auth/popup-timeout',
          'La ventana de Google no respondió a tiempo. Intenta nuevamente desde el botón principal.'
        )
      );
    }, GOOGLE_POPUP_AUTH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([signInWithPopup(authRuntime.auth, googleProvider), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const withGoogleLoginLock = async <T>(runner: () => Promise<T>): Promise<T> => {
  if (!acquireGoogleLoginLock()) {
    const status = getGoogleLoginLockStatus();
    const remainingSeconds = Math.max(1, Math.ceil(status.remainingMs / 1000));
    throw createAuthError(
      'auth/multi-tab-login-in-progress',
      `Ya hay un inicio de sesión en progreso en otra pestaña. Intenta nuevamente en ${remainingSeconds}s.`
    );
  }

  const stopLockHeartbeat = startGoogleLoginLockHeartbeat();
  try {
    return await runner();
  } finally {
    stopLockHeartbeat();
    releaseGoogleLoginLock();
  }
};

export const signInWithGoogle = async (options?: AuthRuntimeOptions): Promise<AuthUser> =>
  withGoogleLoginLock(async () => {
    const authRuntime = resolveAuthRuntime(options);
    try {
      await authRuntime.ready;
      await waitForE2EPopupDelay();

      const existingUser = await authorizeCurrentFirebaseUser({ authRuntime });
      if (existingUser) {
        return existingUser;
      }

      const e2ePopupUser = await resolveE2EPopupUser();
      if (e2ePopupUser) {
        return e2ePopupUser;
      }

      const result = await signInWithPopupTimeout(authRuntime);
      return await authorizeFirebaseUser(result.user, { authRuntime });
    } catch (error: unknown) {
      const authError = error as { message?: string };
      if (authError.message?.includes('no autorizado')) {
        throw error;
      }

      const mappedError = toGoogleAuthError(error);
      recordAuthOperationalError('sign_in_google', error, {
        code: mappedError.code,
        message: mappedError.message,
        severity: isPopupRecoverableAuthError(error) ? 'warning' : 'error',
        runtimeState: isPopupRecoverableAuthError(error) ? 'recoverable' : 'blocked',
        userSafeMessage: mappedError.message,
      });

      // Only fall back to the redirect flow when the popup could not open (or
      // close) at all. On auth/popup-timeout the window is still open and the
      // user may be mid-login: navigating away would destroy their progress.
      if (isPopupOpenFailureAuthError(error)) {
        emitAuthOperationalEvent('sign_in_google_popup_recovery', 'recoverable', {
          code: 'auth_google_popup_recovery_suggested',
          message: 'Trying alternate Google sign-in flow after browser popup issue.',
          severity: 'warning',
          runtimeState: 'recoverable',
          userSafeMessage: 'Puedes probar la forma alternativa de ingreso con Google.',
          context: {
            errorCode: mappedError.code,
          },
        });

        try {
          await signInWithGoogleRedirect({
            authRuntime,
            allowLocalhostFallback: true,
          });
        } catch (redirectError) {
          recordAuthOperationalError('sign_in_google_redirect_fallback', redirectError, {
            code: mappedError.code,
            message: mappedError.message,
            severity: 'warning',
            runtimeState: 'recoverable',
            userSafeMessage: mappedError.message,
            context: {
              fallbackFlow: 'redirect',
              originalErrorCode: mappedError.code,
            },
          });
        }
      }

      throw mappedError;
    }
  });
