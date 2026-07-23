import { getRedirectResult, signInWithRedirect } from 'firebase/auth';
import type { AuthSessionState } from '@/types/authSessionTypes';
import { googleProvider } from '@/services/auth/authShared';
import {
  consumeE2ERedirectPendingUser,
  readE2ERedirectMode,
} from '@/services/auth/authE2ERedirectRuntime';
import {
  clearGoogleLoginAttemptHint,
  hasRecentGoogleLoginAttemptHint,
} from '@/services/auth/authStorageHints';
import {
  clearAuthBootstrapPending,
  isAuthBootstrapPending,
  markAuthBootstrapPending,
} from '@/services/auth/authBootstrapState';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { authorizeFirebaseUser } from '@/services/auth/authAccessResolution';
import { getAuthRedirectRuntimeSupport } from '@/services/auth/authRedirectRuntime';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import { createOperationalError } from '@/services/observability/operationalError';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import {
  createAuthErrorSessionState,
  toResolvedAuthSessionState,
} from '@/services/auth/authSessionState';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';

interface AuthRuntimeOptions {
  authRuntime?: AuthRuntime;
}

interface GoogleRedirectOptions extends AuthRuntimeOptions {
  allowLocalhostFallback?: boolean;
}

const resolveAuthRuntime = ({ authRuntime }: AuthRuntimeOptions = {}): AuthRuntime =>
  authRuntime ?? defaultAuthRuntime;

const runE2ERedirectMode = async (mode: 'success' | 'error' | 'timeout'): Promise<void> => {
  if (mode === 'error') {
    throw new Error('E2E redirect failed');
  }

  if (mode === 'timeout') {
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error('E2E redirect timeout')), 1200);
    });
    return;
  }

  markAuthBootstrapPending('redirect');
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      'hhr_e2e_redirect_pending_user',
      JSON.stringify({
        uid: 'e2e-redirect-user',
        email: 'e2e.redirect@hospital.cl',
        displayName: 'E2E Redirect User',
        role: 'admin',
      })
    );
  }
};

export const hasActiveFirebaseSession = (options?: AuthRuntimeOptions): boolean =>
  resolveAuthRuntime(options).getCurrentUser() !== null;

export const signInWithGoogleRedirect = async (options?: GoogleRedirectOptions): Promise<void> => {
  const authRuntime = resolveAuthRuntime(options);
  try {
    const e2eRedirectMode = readE2ERedirectMode();
    if (e2eRedirectMode) {
      await runE2ERedirectMode(e2eRedirectMode);
      return;
    }

    await authRuntime.ready;
    const redirectRuntimeSupport = getAuthRedirectRuntimeSupport();
    const canBypassLocalhostRedirectBlock =
      options?.allowLocalhostFallback === true &&
      redirectRuntimeSupport.isLocalhostRuntime &&
      redirectRuntimeSupport.authDomain.length > 0;
    if (!redirectRuntimeSupport.canUseRedirectAuth && !canBypassLocalhostRedirectBlock) {
      throw createOperationalError({
        code: 'auth_redirect_unavailable',
        message: redirectRuntimeSupport.redirectDisabledReason || AUTH_UI_COPY.redirectUnavailable,
        severity: 'warning',
        userSafeMessage:
          redirectRuntimeSupport.redirectDisabledReason || AUTH_UI_COPY.redirectUnavailable,
        context: {
          canUseRedirectAuth: redirectRuntimeSupport.canUseRedirectAuth,
        },
      });
    }

    markAuthBootstrapPending('redirect');
    await signInWithRedirect(authRuntime.auth, googleProvider);
  } catch (error) {
    const operationalError = recordOperationalErrorTelemetry(
      'auth',
      'sign_in_google_redirect',
      error,
      {
        code: 'auth_redirect_start_failed',
        message: AUTH_UI_COPY.redirectUnavailable,
        severity: 'error',
        runtimeState: 'blocked',
        userSafeMessage: AUTH_UI_COPY.redirectUnavailable,
      },
      {
        context: {
          hasActiveFirebaseSession: hasActiveFirebaseSession({ authRuntime }),
        },
      }
    );
    throw operationalError;
  }
};

export const handleSignInRedirectResult = async (
  options?: AuthRuntimeOptions
): Promise<AuthSessionState | null> => {
  const authRuntime = resolveAuthRuntime(options);
  try {
    await authRuntime.ready;
    const e2eRedirectUser = consumeE2ERedirectPendingUser();
    if (e2eRedirectUser) {
      return toResolvedAuthSessionState(e2eRedirectUser);
    }

    // The pending-redirect flag lives in localStorage and is visible to every
    // tab; the login-attempt hint lives in sessionStorage and only exists in
    // the tab that actually started the Google flow (it survives the redirect
    // round-trip). Surfacing the empty-result error requires the per-tab hint,
    // so a stale flag can never alarm unrelated tabs.
    const hadPendingRedirect = isAuthBootstrapPending();
    const hadRecentGoogleLoginAttempt = hasRecentGoogleLoginAttemptHint();
    const result = await getRedirectResult(authRuntime.auth);
    if (!result) {
      if (!hadRecentGoogleLoginAttempt && hadPendingRedirect) {
        // Keep observability for the quiet path: either another tab's stale
        // flag, or a same-tab redirect whose sessionStorage did not survive
        // the round trip (locked-down/PWA contexts).
        recordOperationalTelemetry({
          category: 'auth',
          operation: 'redirect_empty_result_without_tab_hint',
          status: 'degraded',
          runtimeState: 'recoverable',
          context: {
            isOnline: typeof window !== 'undefined' ? window.navigator.onLine : null,
          },
          issues: ['Pending redirect flag resolved empty without a per-tab login attempt hint.'],
        });
      }

      if (hadRecentGoogleLoginAttempt) {
        return createAuthErrorSessionState({
          code: 'auth/redirect-empty-result',
          message: 'Google no devolvio una sesion valida al finalizar el redirect.',
          userSafeMessage:
            'No se pudo confirmar la sesion con Google en este navegador. Intenta nuevamente o reinicia los datos locales si el problema persiste.',
          retryable: true,
          severity: 'warning',
          telemetryTags: ['auth', 'redirect'],
        });
      }

      return null;
    }
    return toResolvedAuthSessionState(await authorizeFirebaseUser(result.user, { authRuntime }));
  } catch (error) {
    const operationalError = recordOperationalErrorTelemetry(
      'auth',
      'handle_sign_in_redirect_result',
      error,
      {
        code: 'auth_redirect_result_failed',
        message: 'No se pudo completar el retorno del acceso con Google.',
        severity: 'warning',
        runtimeState: 'recoverable',
        userSafeMessage: 'No se pudo completar el retorno del acceso con Google.',
      }
    );
    return createAuthErrorSessionState({
      code: operationalError.code,
      message: operationalError.message,
      userSafeMessage: operationalError.userSafeMessage,
      severity: 'warning',
      technicalContext: operationalError.context,
      telemetryTags: ['auth', 'redirect'],
    });
  } finally {
    clearGoogleLoginAttemptHint();
    clearAuthBootstrapPending();
  }
};
