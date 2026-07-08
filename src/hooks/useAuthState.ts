import { useEffect, useMemo, useState } from 'react';
import { signOut, onAuthSessionStateChange } from '@/services/auth/authSession';
import { hasActiveFirebaseSession } from '@/services/auth/authFallback';
import {
  executeRedirectAuthResolution,
  executeResolvedCurrentAuthSessionState,
} from '@/application/auth/authSessionUseCases';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser, UserRole } from '@/types/authRoleTypes';
export type { AuthSessionState, UserRole };
import {
  createHandleLogout,
  getE2EBootstrapUser,
  useFirebaseConnectionStatus,
  useInactivityLogout,
  useOnlineStatus,
  useResolvedAuthBootstrap,
} from '@/hooks/useAuthStateSupport';
import { hasRecentManualLogout } from '@/services/auth/authLogoutState';
import { isAuthBootstrapPending } from '@/services/auth/authBootstrapState';
import {
  hasPersistedFirebaseAuthHint,
  hasRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import {
  createAuthenticatingAuthSessionState,
  createUnauthenticatedAuthSessionState,
  getAuthSessionStateUser,
  toResolvedAuthSessionState,
} from '@/services/auth/authSessionState';
import {
  type FirestoreSyncState,
  type RemoteSyncRuntimeStatus,
} from '@/services/repositories/repositoryConfig';
import {
  reconcileAuthorizedSessionOwner,
  resolveSessionOwnerKey,
} from '@/services/storage/sessionScopedStorageService';
import {
  resolveNormalizedAuthOperationalState,
  type NormalizedAuthOperationalState,
} from '@/services/auth/authOperationalState';
import type { AuthRuntimeSnapshot } from '@/services/auth/authRuntimeSnapshot';
import { onAuthChannelMessage } from '@/services/auth/authBroadcastChannel';
import { clearQueryCache } from '@/config/queryClient';

const shouldInitializeAsUnauthenticated = (): boolean => {
  const hasActiveSession = hasActiveFirebaseSession();

  if (hasRecentManualLogout() && !hasActiveSession) {
    return true;
  }

  if (hasRecentAuthenticatedSessionHint()) {
    return false;
  }

  return !hasActiveSession && !isAuthBootstrapPending() && !hasPersistedFirebaseAuthHint();
};

/**
 * Return type for the useAuthState hook.
 * Provides user authentication state, role information, and auth actions.
 */
export interface UseAuthStateReturn {
  /** Canonical authentication session state */
  sessionState: AuthSessionState;
  /** Current actor user derived from session state */
  currentUser: AuthUser | null;
  /** Current fully authorized user; excludes anonymous access */
  authorizedUser: AuthUser | null;
  /** @deprecated Prefer currentUser or authorizedUser */
  user: AuthUser | null;
  /** True while authentication state is being determined */
  authLoading: boolean;
  /** True if connected to Firebase (either real or anonymous auth) */
  isFirebaseConnected: boolean;
  /** Estado operativo del runtime remoto para sync y suscripciones */
  remoteSyncStatus: RemoteSyncRuntimeStatus;
  /** Estado operativo enriquecido del runtime remoto */
  remoteSyncState: FirestoreSyncState;
  /** Snapshot operativo de auth bootstrap y sesión */
  authRuntime: AuthRuntimeSnapshot;
  /** Signs out the current user */
  handleLogout: (reason?: 'manual' | 'automatic') => Promise<void>;

  // Role-based properties
  /** Current user's role */
  role: UserRole;
  /** True if user has edit permissions in at least one module */
  isEditor: boolean;
  /** True if user only has view permissions */
  isViewer: boolean;
  /** Alias for isEditor - true if user can modify data */
  canEdit: boolean;
}

/**
 * useAuthState Hook
 *
 * Central hook for managing authentication state throughout the application.
 * Supports Firebase auth plus anonymous signature-mode access.
 * Firebase connection status is monitored to enable/disable sync features.
 *
 * @returns Authentication state, user info, role flags, and auth actions
 */
export const useAuthState = (): UseAuthStateReturn => {
  const [e2eBootstrapUser] = useState<AuthUser | null>(() => getE2EBootstrapUser());
  const [initializesUnauthenticated] = useState(
    () => !e2eBootstrapUser && shouldInitializeAsUnauthenticated()
  );
  const [sessionState, setSessionState] = useState<AuthSessionState>(() => {
    if (e2eBootstrapUser) {
      return toResolvedAuthSessionState(e2eBootstrapUser);
    }

    return initializesUnauthenticated
      ? createUnauthenticatedAuthSessionState()
      : createAuthenticatingAuthSessionState();
  });
  const currentUser = getAuthSessionStateUser(sessionState);
  const [authLoading, setAuthLoading] = useState(!e2eBootstrapUser && !initializesUnauthenticated);
  const isOnline = useOnlineStatus();
  const handleLogout = useMemo(
    () => createHandleLogout(currentUser, signOut, setSessionState),
    [currentUser]
  );
  const isFirebaseConnected = useFirebaseConnectionStatus(
    currentUser,
    isOnline,
    hasActiveFirebaseSession
  );

  useInactivityLogout(currentUser, handleLogout);
  useResolvedAuthBootstrap({
    e2eBootstrapUser,
    resolveRedirectAuthSessionOutcome: executeRedirectAuthResolution,
    resolveCurrentAuthSessionOutcome: executeResolvedCurrentAuthSessionState,
    onAuthSessionStateChange,
    setSessionState,
    setAuthLoading,
  });

  // Keep auth-derived operational flags behind the shared normalizer so the hook
  // and the context stay aligned on the same semantics.
  const operationalState = useMemo<NormalizedAuthOperationalState>(
    () =>
      resolveNormalizedAuthOperationalState({
        sessionState,
        authLoading,
        isFirebaseConnected,
        isOnline,
        handleLogout,
      }),
    [sessionState, authLoading, isFirebaseConnected, isOnline, handleLogout]
  );

  useEffect(() => {
    if (operationalState.authLoading || !operationalState.authorizedUser) {
      return;
    }

    const ownerKey = resolveSessionOwnerKey(operationalState.authorizedUser.uid);
    if (!ownerKey) {
      return;
    }

    void reconcileAuthorizedSessionOwner(ownerKey);
  }, [operationalState.authLoading, operationalState.authorizedUser]);

  // Cross-tab: react to logout/session events from other tabs
  useEffect(() => {
    const cleanup = onAuthChannelMessage(message => {
      if (message.type === 'LOGOUT') {
        clearQueryCache();
        setSessionState(createUnauthenticatedAuthSessionState());
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('hhr_logged_this_session');
        }
      }
    });
    return cleanup;
  }, []);

  return {
    sessionState: operationalState.sessionState,
    currentUser: operationalState.currentUser,
    authorizedUser: operationalState.authorizedUser,
    user: operationalState.currentUser,
    authLoading: operationalState.authLoading,
    isFirebaseConnected: operationalState.isFirebaseConnected,
    remoteSyncStatus: operationalState.remoteSyncStatus,
    remoteSyncState: operationalState.remoteSyncState,
    authRuntime: operationalState.authRuntime,
    handleLogout,
    role: operationalState.role,
    isEditor: operationalState.isEditor,
    isViewer: operationalState.isViewer,
    canEdit: operationalState.isEditor,
  };
};
