import { useEffect, useState } from 'react';
import {
  isPopupCancellationAuthError,
  isPopupOpenFailureAuthError,
  isPopupRecoverableAuthError,
  resolveAuthErrorCode,
} from '@/services/auth/authErrorPolicy';
import { AUTH_UI_COPY } from '@/services/auth/authUiCopy';
import {
  executeGoogleSignIn,
  executeGoogleSignInWarmup,
} from '@/application/auth/authSessionUseCases';
import {
  clearAuthBootstrapPending,
  isAuthBootstrapPending,
} from '@/services/auth/authBootstrapState';
import { getCurrentAuthSessionState } from '@/services/auth/authSession';
import {
  clearRecentAuthenticatedSessionHint,
  clearGoogleLoginAttemptHint,
  markGoogleLoginAttemptHint,
} from '@/services/auth/authStorageHints';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { preloadDefaultPostLoginRoute } from '@/app-shell/bootstrap/authenticatedRoutePreloadController';
import {
  type LoginBackgroundMode,
  persistLoginBackgroundMode,
  resolveInitialLoginBackgroundMode,
} from '@/shared/ui/loginBackgroundModeController';
const POPUP_RECOVERY_GRACE_MS = 1800;
const POPUP_RECOVERY_POLL_MS = 100;
const POPUP_CANCELLATION_SETTLE_MS = 500;
const loginPageLogger = createScopedLogger('LoginPage');

const warmDefaultPostLoginRoute = () => {
  void preloadDefaultPostLoginRoute().catch(err => {
    loginPageLogger.warn('Default post-login preload failed', err);
  });
};

const waitForRecoverablePopupResolution = async (): Promise<boolean> => {
  const hasResolvedSession = () => getCurrentAuthSessionState().status !== 'unauthenticated';
  if (hasResolvedSession() || isAuthBootstrapPending()) {
    return true;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < POPUP_RECOVERY_GRACE_MS) {
    await new Promise(resolve => setTimeout(resolve, POPUP_RECOVERY_POLL_MS));
    if (hasResolvedSession() || isAuthBootstrapPending()) {
      return true;
    }
  }

  return false;
};

const waitForPopupCancellationSettlement = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, POPUP_CANCELLATION_SETTLE_MS));
};

// The "popup blocked" copy is reserved for errors where the Google window
// could not open/close; other recoverable issues (timeout, network) keep their
// own accurate message instead of blaming the popup blocker.
const resolveRecoverablePopupErrorMessage = (errorLike: {
  code?: string;
  message?: string;
}): string =>
  isPopupOpenFailureAuthError(errorLike)
    ? AUTH_UI_COPY.blockedPopupStayOnPage
    : errorLike.message || AUTH_UI_COPY.blockedPopupStayOnPage;

export interface LoginPageControllerState {
  error: string | null;
  errorCode: string | null;
  isGoogleLoading: boolean;
  isAnyLoading: boolean;
  isDayGradient: boolean;
  backgroundMode: LoginBackgroundMode;
  canRetryGoogleSignIn: boolean;
  handleGoogleSignIn: () => Promise<void>;
  handleLocalResetStart: () => void;
  toggleBackgroundMode: () => void;
}

export interface LoginPageInitialAuthError {
  message: string;
  code?: string | null;
}

export const useLoginPageController = (
  onLoginSuccess: () => void,
  initialAuthError?: LoginPageInitialAuthError | null
): LoginPageControllerState => {
  const [error, setError] = useState<string | null>(initialAuthError?.message ?? null);
  const [errorCode, setErrorCode] = useState<string | null>(initialAuthError?.code ?? null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<LoginBackgroundMode>(
    resolveInitialLoginBackgroundMode
  );

  useEffect(() => {
    // Warm the Firebase auth/functions runtime while the user reads the login
    // screen so the click → popup → role-lookup path pays no lazy-load cost.
    executeGoogleSignInWarmup();

    // Prefetch the post-login shell/route chunks on idle time so the
    // transition into the app after a successful login is instant, without
    // competing with the login screen's own first paint.
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleHandle = idleWindow.requestIdleCallback(warmDefaultPostLoginRoute);
    } else {
      timeoutHandle = window.setTimeout(warmDefaultPostLoginRoute, 1_500);
    }

    return () => {
      if (idleHandle !== undefined && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

  useEffect(() => {
    if (!initialAuthError?.message) {
      return;
    }

    setError(initialAuthError.message);
    setErrorCode(initialAuthError.code ?? null);
  }, [initialAuthError?.code, initialAuthError?.message]);

  const handleLocalResetStart = () => {
    clearGoogleLoginAttemptHint();
    clearRecentAuthenticatedSessionHint();
    clearAuthBootstrapPending();
    setIsGoogleLoading(false);
    setError(null);
    setErrorCode(null);
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setErrorCode(null);
    setIsGoogleLoading(true);
    markGoogleLoginAttemptHint();

    try {
      const outcome = await executeGoogleSignIn();
      if (outcome.status === 'success') {
        clearGoogleLoginAttemptHint();
        warmDefaultPostLoginRoute();
        onLoginSuccess();
        return;
      }

      const issue = outcome.issues[0];
      const errorLike = {
        code: issue?.code || outcome.reason || 'auth/google-signin-failed',
        message:
          issue?.userSafeMessage ||
          outcome.userSafeMessage ||
          issue?.message ||
          'Error al iniciar sesión con Google',
      };
      const isPopupIssue = isPopupRecoverableAuthError(errorLike);
      const isPopupCancellation = isPopupCancellationAuthError(errorLike);
      const resolvedErrorCode = resolveAuthErrorCode(errorLike);

      if (isPopupCancellation) {
        clearGoogleLoginAttemptHint();
        setErrorCode(null);
        setError(null);
        await waitForPopupCancellationSettlement();
      } else if (isPopupIssue) {
        if (await waitForRecoverablePopupResolution()) {
          return;
        }
        clearGoogleLoginAttemptHint();
        setErrorCode(resolvedErrorCode || 'auth/popup-recoverable');
        setError(resolveRecoverablePopupErrorMessage(errorLike));
      } else {
        clearGoogleLoginAttemptHint();
        loginPageLogger.warn('Google sign-in failed', outcome);
        setErrorCode(resolvedErrorCode || 'auth/google-signin-failed');
        setError(errorLike.message);
      }
      return;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isPopupIssue = isPopupRecoverableAuthError(err);
      const isPopupCancellation = isPopupCancellationAuthError(err);
      const resolvedErrorCode = resolveAuthErrorCode(err);

      if (isPopupCancellation) {
        clearGoogleLoginAttemptHint();
        setErrorCode(null);
        setError(null);
        await waitForPopupCancellationSettlement();
      } else if (isPopupIssue) {
        if (await waitForRecoverablePopupResolution()) {
          return;
        }
        clearGoogleLoginAttemptHint();
        setErrorCode(resolvedErrorCode || 'auth/popup-recoverable');
        setError(
          resolveRecoverablePopupErrorMessage({
            code: resolvedErrorCode || undefined,
            message: errorMessage,
          })
        );
      } else {
        clearGoogleLoginAttemptHint();
        loginPageLogger.warn('Google sign-in failed', err);
        setErrorCode(resolvedErrorCode || 'auth/google-signin-failed');
        setError(errorMessage || 'Error al iniciar sesión con Google');
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const toggleBackgroundMode = () => {
    setBackgroundMode(prev => {
      const nextMode = prev === 'day' ? 'night' : 'day';
      persistLoginBackgroundMode(nextMode);
      return nextMode;
    });
  };

  const isDayGradient = backgroundMode === 'day';

  return {
    error,
    errorCode,
    isGoogleLoading,
    isAnyLoading: isGoogleLoading,
    isDayGradient,
    backgroundMode,
    canRetryGoogleSignIn: errorCode === 'auth/role-validation-unavailable' && !isGoogleLoading,
    handleGoogleSignIn,
    handleLocalResetStart,
    toggleBackgroundMode,
  };
};
