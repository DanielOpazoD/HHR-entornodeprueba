import type { AuthSessionError, AuthSessionState } from '@/types/authSessionTypes';

export const shouldIgnoreTransientUnauthenticatedBootstrapEvent = ({
  isBootstrapLoading,
  sessionState,
  hasRecentManualLogout,
  hasAuthRehydrationHint,
}: {
  isBootstrapLoading: boolean;
  sessionState: AuthSessionState;
  hasRecentManualLogout: boolean;
  hasAuthRehydrationHint: boolean;
}): boolean =>
  isBootstrapLoading &&
  sessionState.status === 'unauthenticated' &&
  !hasRecentManualLogout &&
  hasAuthRehydrationHint;

export const shouldDeferUnauthenticatedSessionState = ({
  sessionState,
  isAuthBootstrapPending,
}: {
  sessionState: AuthSessionState;
  isAuthBootstrapPending: boolean;
}): boolean => isAuthBootstrapPending && sessionState.status === 'unauthenticated';

export const shouldAttemptAuthTimeoutRecovery = ({
  hasRecentManualLogout,
  hasAuthRehydrationHint,
}: {
  hasRecentManualLogout: boolean;
  hasAuthRehydrationHint: boolean;
}): boolean => !hasRecentManualLogout && hasAuthRehydrationHint;

export const shouldResolveAuthBootstrapImmediatelyAsUnauthenticated = ({
  hasPendingRedirect,
  hasAuthRehydrationHint,
  hasActiveFirebaseSession,
}: {
  hasPendingRedirect: boolean;
  hasAuthRehydrationHint: boolean;
  hasActiveFirebaseSession: boolean;
}): boolean => !hasPendingRedirect && !hasAuthRehydrationHint && !hasActiveFirebaseSession;

export const shouldLogSessionLogin = ({
  sessionState,
  hasLoggedThisSession,
}: {
  sessionState: AuthSessionState;
  hasLoggedThisSession: boolean;
}): boolean =>
  sessionState.status === 'authorized' && Boolean(sessionState.user.email) && !hasLoggedThisSession;

export const buildBootstrapTimeoutIssue = (): string =>
  'La inicializacion de autenticacion excedio el tiempo esperado.';

export const buildBootstrapTimeoutAuthError = (): AuthSessionError => ({
  code: 'auth/bootstrap-timeout',
  message: buildBootstrapTimeoutIssue(),
  userSafeMessage:
    'No se pudo recuperar la sesión de Google. Cierra otras pestañas de HHR y vuelve a intentar desde esta pestaña.',
  retryable: true,
  severity: 'warning',
  telemetryTags: ['auth', 'bootstrap_timeout'],
});
