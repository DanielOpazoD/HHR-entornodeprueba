import { describe, expect, it } from 'vitest';
import {
  buildBootstrapTimeoutAuthError,
  buildBootstrapTimeoutIssue,
  shouldAttemptAuthTimeoutRecovery,
  shouldDeferUnauthenticatedSessionState,
  shouldIgnoreTransientUnauthenticatedBootstrapEvent,
  shouldResolveAuthBootstrapImmediatelyAsUnauthenticated,
  shouldLogSessionLogin,
  SESSION_PERMISSION_STORM_CAUSE,
  shouldPreserveUnauthorizedSessionReason,
} from '@/hooks/controllers/authBootstrapController';
import type { AuthSessionState } from '@/types/authSessionTypes';

describe('authBootstrapController', () => {
  const unauthenticatedSession: AuthSessionState = {
    status: 'unauthenticated',
    user: null,
  };

  const authorizedSession: AuthSessionState = {
    status: 'authorized',
    user: {
      uid: 'user-1',
      email: 'auth@test.cl',
      displayName: 'Auth Test',
      role: 'admin',
    },
  };

  it('ignores only transient unauthenticated events while bootstrap is still rehydrating', () => {
    expect(
      shouldIgnoreTransientUnauthenticatedBootstrapEvent({
        isBootstrapLoading: true,
        sessionState: unauthenticatedSession,
        hasRecentManualLogout: false,
        hasAuthRehydrationHint: true,
      })
    ).toBe(true);

    expect(
      shouldIgnoreTransientUnauthenticatedBootstrapEvent({
        isBootstrapLoading: false,
        sessionState: unauthenticatedSession,
        hasRecentManualLogout: false,
        hasAuthRehydrationHint: true,
      })
    ).toBe(false);
  });

  it('defers unauthenticated state only while bootstrap redirect is pending', () => {
    expect(
      shouldDeferUnauthenticatedSessionState({
        sessionState: unauthenticatedSession,
        isAuthBootstrapPending: true,
      })
    ).toBe(true);

    expect(
      shouldDeferUnauthenticatedSessionState({
        sessionState: authorizedSession,
        isAuthBootstrapPending: true,
      })
    ).toBe(false);
  });

  it('attempts timeout recovery only when there is persisted auth and no recent manual logout', () => {
    expect(
      shouldAttemptAuthTimeoutRecovery({
        hasRecentManualLogout: false,
        hasAuthRehydrationHint: true,
      })
    ).toBe(true);

    expect(
      shouldAttemptAuthTimeoutRecovery({
        hasRecentManualLogout: true,
        hasAuthRehydrationHint: true,
      })
    ).toBe(false);
  });

  it('resolves immediately as unauthenticated only when no rehydration hint exists', () => {
    expect(
      shouldResolveAuthBootstrapImmediatelyAsUnauthenticated({
        hasPendingRedirect: false,
        hasAuthRehydrationHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe(true);

    expect(
      shouldResolveAuthBootstrapImmediatelyAsUnauthenticated({
        hasPendingRedirect: false,
        hasAuthRehydrationHint: true,
        hasActiveFirebaseSession: false,
      })
    ).toBe(false);
  });

  it('logs session login only for authorized sessions with email that were not logged yet', () => {
    expect(
      shouldLogSessionLogin({
        sessionState: authorizedSession,
        hasLoggedThisSession: false,
      })
    ).toBe(true);

    expect(
      shouldLogSessionLogin({
        sessionState: authorizedSession,
        hasLoggedThisSession: true,
      })
    ).toBe(false);
  });

  it('un evento unauthenticated no degrada SOLO el unauthorized de la guarda de sesión (por su causa)', () => {
    const guardState = {
      status: 'unauthorized',
      user: null,
      reason: 'Tu sesión perdió los permisos. Vuelve a iniciar sesión.',
      technicalContext: { cause: SESSION_PERMISSION_STORM_CAUSE },
    } as AuthSessionState;
    const unauthenticated = { status: 'unauthenticated', user: null } as AuthSessionState;
    // Otros unauthorized llevan códigos crudos y deben poder ser reemplazados.
    const roleNotResolved = {
      status: 'unauthorized',
      user: null,
      reason: 'role_not_resolved',
    } as AuthSessionState;

    expect(shouldPreserveUnauthorizedSessionReason(guardState, unauthenticated)).toBe(true);
    expect(shouldPreserveUnauthorizedSessionReason(roleNotResolved, unauthenticated)).toBe(false);
    expect(
      shouldPreserveUnauthorizedSessionReason(guardState, {
        status: 'authorized',
        user: { uid: 'u1', email: 'u1@h.test', role: 'nurse' },
      } as unknown as AuthSessionState)
    ).toBe(false);
    expect(shouldPreserveUnauthorizedSessionReason(unauthenticated, unauthenticated)).toBe(false);
  });

  it('keeps the timeout issue string centralized', () => {
    expect(buildBootstrapTimeoutIssue()).toBe(
      'La inicializacion de autenticacion excedio el tiempo esperado.'
    );
  });

  it('builds a retryable auth error for bootstrap timeouts', () => {
    expect(buildBootstrapTimeoutAuthError()).toMatchObject({
      code: 'auth/bootstrap-timeout',
      message: 'La inicializacion de autenticacion excedio el tiempo esperado.',
      retryable: true,
      severity: 'warning',
      telemetryTags: ['auth', 'bootstrap_timeout'],
    });
  });
});
