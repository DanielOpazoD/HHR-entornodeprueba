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
import { clearRecentAuthRoleLookups } from '@/services/auth/authRoleLookup';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { markPerf } from '@/shared/runtime/perfAudit';

interface AuthRuntimeOptions {
  authRuntime?: AuthRuntime;
}

// Explicit logout invalidates pending resolutions before Firebase emits null.
let logoutGeneration = 0;

const resolveAuthRuntime = ({ authRuntime }: AuthRuntimeOptions = {}): AuthRuntime =>
  authRuntime ?? defaultAuthRuntime;

export const signOut = async (options?: AuthRuntimeOptions): Promise<void> => {
  logoutGeneration += 1;
  const authRuntime = resolveAuthRuntime(options);
  await authRuntime.ready;
  const userEmail = authRuntime.getCurrentUser()?.email;
  clearRecentAuthRoleLookups();
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
  let revision = 0;
  let unsubscribeAuth = () => {};

  markPerf('auth-session:runtime-ready-wait-start');
  void authRuntime.ready
    .then(() => {
      markPerf('auth-session:runtime-ready-done');
      if (!active) {
        return;
      }

      const detach = onAuthStateChanged(authRuntime.auth, async (firebaseUser: User | null) => {
        const eventRevision = ++revision;
        const generation = logoutGeneration;
        const isCurrent = () =>
          active && revision === eventRevision && generation === logoutGeneration;
        if (!isCurrent()) return;
        markPerf('auth-session:firebase-event', firebaseUser ? 'user' : 'null');
        if (firebaseUser) {
          markPerf('auth-session:user-event');
        }
        if (!firebaseUser) {
          clearRecentAuthRoleLookups();
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
            signOutUnauthorizedUser: async () => {
              if (isCurrent()) await firebaseSignOut(authRuntime.auth);
            },
            // The observer is the authoritative reconciliation point. It must
            // not accept the bootstrap cache because role revocations need to
            // take effect during an ordinary restored session too.
            resolveFirebaseUserRole,
          });
          if (!isCurrent()) return;
          markPerf('auth-session:role-resolution-done', sessionState.status);
          if (sessionState.status !== 'authorized') {
            resetAuthClaimSyncSnapshot();
          }
          await callback(sessionState);
          if (isCurrent() && sessionState.status === 'authorized' && sessionState.user.role) {
            void ensureUserRoleClaim(firebaseUser, sessionState.user.role);
          }
        } catch (error) {
          if (!isCurrent()) return;
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
      markPerf('auth-session:observer-attached');
      unsubscribeAuth = () => {
        detach();
        markPerf('auth-session:observer-detached');
      };
    })
    .catch(async error => {
      if (!active) return;
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
    if (!active) return;
    active = false;
    unsubscribeAuth();
  };
};

export const resolveCurrentAuthSessionState = async (
  options?: AuthRuntimeOptions
): Promise<AuthSessionState | null> => {
  const authRuntime = resolveAuthRuntime(options);
  const generation = logoutGeneration;
  markPerf('auth-current:runtime-ready-wait-start');
  await authRuntime.ready;
  markPerf('auth-current:runtime-ready-done');
  const firebaseUser = authRuntime.getCurrentUser();
  if (generation !== logoutGeneration) return null;
  const isCurrent = () =>
    generation === logoutGeneration && authRuntime.getCurrentUser() === firebaseUser;
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
      signOutUnauthorizedUser: async () => {
        if (isCurrent()) await firebaseSignOut(authRuntime.auth);
      },
      resolveFirebaseUserRole: resolveFirebaseUserRoleForBootstrap,
    });
    if (!isCurrent()) return null;
    markPerf('auth-current:role-resolution-done', sessionState.status);
    if (sessionState.status !== 'authorized') {
      resetAuthClaimSyncSnapshot();
    }
    if (sessionState.status === 'authorized' && sessionState.user.role) {
      void ensureUserRoleClaim(firebaseUser, sessionState.user.role);
    }
    return sessionState;
  } catch (error) {
    if (!isCurrent()) return null;
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
