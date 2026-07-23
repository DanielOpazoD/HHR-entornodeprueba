import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import type { AuthSessionState } from '@/types/authSessionTypes';
import { clearRoleCacheForEmail } from '@/services/auth/authPolicy';
import {
  resolveFirebaseUserRole,
  resolveFirebaseUserRoleForBootstrap,
} from '@/services/auth/authAccessResolution';
import { resolveAuthSessionState } from '@/services/auth/authSessionController';
import { recordAuthOperationalError } from '@/services/auth/authOperationalTelemetry';
import {
  ensureUserRoleClaim,
  resetAuthClaimSyncSnapshot,
} from '@/services/auth/authClaimSyncService';
import {
  createAuthErrorSessionState,
  createUnauthenticatedAuthSessionState,
  createUnauthorizedAuthSessionState,
  toAnonymousSignatureAuthSessionState,
} from '@/services/auth/authSessionState';
import { hasRecentGoogleLoginAttemptHint } from '@/services/auth/authStorageHints';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { markPerf } from '@/shared/runtime/perfAudit';

interface AuthRuntimeOptions {
  authRuntime?: AuthRuntime;
}

const resolveAuthRuntime = ({ authRuntime }: AuthRuntimeOptions = {}): AuthRuntime =>
  authRuntime ?? defaultAuthRuntime;

// A sign-in that completed moments ago must be authorized strictly even when
// the per-tab login-attempt hint is gone (e.g. the user finished the Google
// popup after the UI-level timeout already cleared the hint).
const FRESH_SIGN_IN_STRICT_WINDOW_MS = 5 * 60_000;

const isFreshInteractiveSignIn = (firebaseUser: User): boolean => {
  const lastSignInTime = firebaseUser.metadata?.lastSignInTime;
  if (!lastSignInTime) return false;
  const lastSignInAt = new Date(lastSignInTime).getTime();
  return (
    Number.isFinite(lastSignInAt) && Date.now() - lastSignInAt < FRESH_SIGN_IN_STRICT_WINDOW_MS
  );
};

// During an active Google login attempt — or right after a fresh interactive
// sign-in — the role must be resolved strictly (fresh checkUserRole lookup).
// Outside of that window the observer event is a session rehydration (page
// refresh / restored persistence), where the cached role is accepted — same
// policy resolveCurrentAuthSessionState already uses for this scenario, so
// refreshes stop paying a Cloud Function round-trip.
export const shouldResolveObserverRoleStrictly = (firebaseUser: User): boolean =>
  hasRecentGoogleLoginAttemptHint() || isFreshInteractiveSignIn(firebaseUser);

const resolveObserverFirebaseUserRole = (firebaseUser: User) =>
  shouldResolveObserverRoleStrictly(firebaseUser)
    ? resolveFirebaseUserRole(firebaseUser)
    : resolveFirebaseUserRoleForBootstrap(firebaseUser);

export const signOut = async (options?: AuthRuntimeOptions): Promise<void> => {
  const authRuntime = resolveAuthRuntime(options);
  await authRuntime.ready;
  const userEmail = authRuntime.getCurrentUser()?.email;
  resetAuthClaimSyncSnapshot();
  await firebaseSignOut(authRuntime.auth);

  if (userEmail) {
    try {
      await clearRoleCacheForEmail(userEmail);
    } catch (error) {
      recordAuthOperationalError('sign_out_clear_role_cache', error, {
        code: 'auth_role_cache_clear_failed',
        message: 'Failed to clear role cache on sign out.',
        severity: 'warning',
        userSafeMessage: 'La sesión se cerró, pero no se pudo limpiar el cache de roles.',
        context: {
          email: userEmail,
        },
      });
    }
  }
};

export const onAuthSessionStateChange = (
  callback: (sessionState: AuthSessionState) => void | Promise<void>,
  options?: AuthRuntimeOptions
): (() => void) => {
  const authRuntime = resolveAuthRuntime(options);
  let active = true;
  let unsubscribeAuth = () => {};

  markPerf('auth-session:runtime-ready-wait-start');
  void authRuntime.ready
    .then(() => {
      markPerf('auth-session:runtime-ready-done');
      if (!active) {
        return;
      }

      unsubscribeAuth = onAuthStateChanged(authRuntime.auth, async (firebaseUser: User | null) => {
        markPerf('auth-session:firebase-event', firebaseUser ? 'user' : 'null');
        if (!firebaseUser) {
          resetAuthClaimSyncSnapshot();
          await callback(createUnauthenticatedAuthSessionState());
          return;
        }

        if (firebaseUser.isAnonymous) {
          resetAuthClaimSyncSnapshot();
          await callback(
            toAnonymousSignatureAuthSessionState({
              uid: firebaseUser.uid,
              email: null,
              displayName: 'Anonymous Doctor',
              role: 'viewer',
            })
          );
          return;
        }

        try {
          markPerf('auth-session:role-resolution-start');
          const sessionState = await resolveAuthSessionState(firebaseUser, {
            signOutUnauthorizedUser: () => firebaseSignOut(authRuntime.auth),
            resolveFirebaseUserRole: resolveObserverFirebaseUserRole,
          });
          markPerf('auth-session:role-resolution-done', sessionState.status);
          if (sessionState.status !== 'authorized') {
            resetAuthClaimSyncSnapshot();
          }
          await callback(sessionState);
          if (sessionState.status === 'authorized' && sessionState.user.role) {
            void ensureUserRoleClaim(firebaseUser, sessionState.user.role);
          }
        } catch (error) {
          resetAuthClaimSyncSnapshot();
          const operationalError = recordAuthOperationalError(
            'on_auth_session_state_change',
            error,
            {
              code: 'auth_session_state_resolution_failed',
              message: 'Failed to resolve authentication session state.',
              severity: 'warning',
              userSafeMessage: 'No se pudo resolver la sesión actual.',
            }
          );
          await callback(
            createAuthErrorSessionState({
              code: operationalError.code,
              message: operationalError.message,
              userSafeMessage: operationalError.userSafeMessage,
              severity: operationalError.severity === 'error' ? 'error' : 'warning',
              technicalContext: operationalError.context,
              telemetryTags: ['auth', 'session_state'],
            })
          );
        }
      });
    })
    .catch(async error => {
      resetAuthClaimSyncSnapshot();
      const operationalError = recordAuthOperationalError('on_auth_session_state_change', error, {
        code: 'auth_session_state_resolution_failed',
        message: 'Failed to initialize authentication session observer.',
        severity: 'warning',
        userSafeMessage: 'No se pudo inicializar la sesión actual.',
      });
      if (active) {
        await callback(
          createAuthErrorSessionState({
            code: operationalError.code,
            message: operationalError.message,
            userSafeMessage: operationalError.userSafeMessage,
            severity: operationalError.severity === 'error' ? 'error' : 'warning',
            technicalContext: operationalError.context,
            telemetryTags: ['auth', 'session_state'],
          })
        );
      }
    });

  return () => {
    active = false;
    unsubscribeAuth();
  };
};

export const resolveCurrentAuthSessionState = async (
  options?: AuthRuntimeOptions
): Promise<AuthSessionState> => {
  const authRuntime = resolveAuthRuntime(options);
  markPerf('auth-current:runtime-ready-wait-start');
  await authRuntime.ready;
  markPerf('auth-current:runtime-ready-done');
  const firebaseUser = authRuntime.getCurrentUser();
  markPerf('auth-current:user-state', firebaseUser ? 'user' : 'null');

  if (!firebaseUser) {
    resetAuthClaimSyncSnapshot();
    return createUnauthenticatedAuthSessionState();
  }

  if (firebaseUser.isAnonymous) {
    resetAuthClaimSyncSnapshot();
    return toAnonymousSignatureAuthSessionState({
      uid: firebaseUser.uid,
      email: null,
      displayName: 'Anonymous Doctor',
      role: 'viewer',
    });
  }

  try {
    markPerf('auth-current:role-resolution-start');
    const sessionState = await resolveAuthSessionState(firebaseUser, {
      signOutUnauthorizedUser: () => firebaseSignOut(authRuntime.auth),
      resolveFirebaseUserRole: resolveFirebaseUserRoleForBootstrap,
    });
    markPerf('auth-current:role-resolution-done', sessionState.status);
    if (sessionState.status !== 'authorized') {
      resetAuthClaimSyncSnapshot();
    }
    if (sessionState.status === 'authorized' && sessionState.user.role) {
      void ensureUserRoleClaim(firebaseUser, sessionState.user.role);
    }
    return sessionState;
  } catch (error) {
    resetAuthClaimSyncSnapshot();
    const operationalError = recordAuthOperationalError(
      'resolve_current_auth_session_state',
      error,
      {
        code: 'auth_session_state_resolution_failed',
        message: 'Failed to resolve the current authentication session state.',
        severity: 'warning',
        userSafeMessage: 'No se pudo resolver la sesion actual.',
      }
    );
    return createAuthErrorSessionState({
      code: operationalError.code,
      message: operationalError.message,
      userSafeMessage: operationalError.userSafeMessage,
      severity: operationalError.severity === 'error' ? 'error' : 'warning',
      technicalContext: operationalError.context,
      telemetryTags: ['auth', 'session_state'],
    });
  }
};

export const getCurrentAuthSessionState = (options?: AuthRuntimeOptions): AuthSessionState => {
  const authRuntime = resolveAuthRuntime(options);
  const user = authRuntime.getCurrentUser();
  if (!user) {
    return createUnauthenticatedAuthSessionState();
  }

  if (user.isAnonymous) {
    return toAnonymousSignatureAuthSessionState({
      uid: user.uid,
      email: null,
      displayName: 'Anonymous Doctor',
      role: 'viewer',
    });
  }

  return createUnauthorizedAuthSessionState('session_requires_resolution', {
    email: user.email,
  });
};
