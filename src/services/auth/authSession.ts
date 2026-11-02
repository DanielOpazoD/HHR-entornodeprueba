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
import {
  clearConfirmedAuthRole,
  getConfirmedAuthRole,
  getDynamicRoleForEmail,
  rememberConfirmedAuthRole,
  clearRecentAuthRoleLookups,
} from '@/services/auth/authRoleLookup';
import { type AuthRuntime, defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { toAuthUser } from '@/services/auth/authShared';
import { toResolvedAuthSessionState } from '@/services/auth/authSessionState';
import { getLogoutRevision } from '@/services/auth/authLogoutState';
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
  clearConfirmedAuthRole();
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
        const closureRevision = getLogoutRevision();
        const isCurrent = () =>
          active &&
          revision === eventRevision &&
          generation === logoutGeneration &&
          closureRevision === getLogoutRevision();
        if (!isCurrent()) return;
        markPerf('auth-session:firebase-event', firebaseUser ? 'user' : 'null');
        if (firebaseUser) {
          markPerf('auth-session:user-event');
        }
        if (!firebaseUser) {
          clearConfirmedAuthRole();
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

        const rememberedRole = getConfirmedAuthRole(firebaseUser);
        try {
          if (rememberedRole) {
            await callback(toResolvedAuthSessionState(toAuthUser(firebaseUser, rememberedRole)));
            if (!isCurrent()) return;
          }
          markPerf('auth-session:role-resolution-start');
          const sessionState = await resolveAuthSessionState(firebaseUser, {
            signOutUnauthorizedUser: async () => {
              if (isCurrent()) {
                clearConfirmedAuthRole();
                if (rememberedRole) {
                  await callback(
                    createUnauthorizedAuthSessionState('role_not_resolved', {
                      email: firebaseUser.email,
                    })
                  );
                }
                // The app callback may already have begun its canonical logout.
                if (isCurrent()) await firebaseSignOut(authRuntime.auth);
              }
            },
            // Remembered admission never turns a transport failure or old claim into
            // a new confirmation. The lookup owns the existing silent retry delays.
            resolveFirebaseUserRole: async user => {
              if (!rememberedRole) return resolveFirebaseUserRole(user, isCurrent);
              const role = await getDynamicRoleForEmail(user.email || '');
              if (role && isCurrent()) await rememberConfirmedAuthRole(user, role, isCurrent);
              return role;
            },
          });
          if (!isCurrent()) return;
          markPerf('auth-session:role-resolution-done', sessionState.status);
          if (sessionState.status !== 'authorized') {
            resetAuthClaimSyncSnapshot();
          }
          if (
            !(
              rememberedRole &&
              sessionState.status === 'authorized' &&
              sessionState.user.role === rememberedRole
            )
          ) {
            await callback(sessionState);
          }
          if (isCurrent() && sessionState.status === 'authorized' && sessionState.user.role) {
            void ensureUserRoleClaim(firebaseUser, sessionState.user.role);
          }
        } catch (error) {
          if (!isCurrent()) return;
          if (rememberedRole) return;
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
  const closureRevision = getLogoutRevision();
  markPerf('auth-current:runtime-ready-wait-start');
  await authRuntime.ready;
  markPerf('auth-current:runtime-ready-done');
  const firebaseUser = authRuntime.getCurrentUser();
  if (generation !== logoutGeneration || closureRevision !== getLogoutRevision()) return null;
  const isCurrent = () =>
    generation === logoutGeneration &&
    closureRevision === getLogoutRevision() &&
    authRuntime.getCurrentUser() === firebaseUser;
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

  const rememberedRole = getConfirmedAuthRole(firebaseUser);
  if (rememberedRole) return toResolvedAuthSessionState(toAuthUser(firebaseUser, rememberedRole));

  try {
    markPerf('auth-current:role-resolution-start');
    const sessionState = await resolveAuthSessionState(firebaseUser, {
      signOutUnauthorizedUser: async () => {
        if (isCurrent()) {
          clearConfirmedAuthRole();
          await firebaseSignOut(authRuntime.auth);
        }
      },
      resolveFirebaseUserRole: user => resolveFirebaseUserRoleForBootstrap(user, isCurrent),
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
