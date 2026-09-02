import { useCallback, useEffect, useMemo, useState } from 'react';
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
  resetLocationToLoginRoute,
  useFirebaseConnectionStatus,
  useInactivityLogout,
  useOnlineStatus,
  useResolvedAuthBootstrap,
} from '@/hooks/useAuthStateSupport';
import { hasRecentManualLogout } from '@/services/auth/authLogoutState';
import { useSessionPermissionGuard } from '@/hooks/useSessionPermissionGuard';
import { shouldPreserveUnauthorizedSessionReason } from '@/hooks/controllers/authBootstrapController';
import { isAuthBootstrapPending } from '@/services/auth/authBootstrapState';
import {
  clearPersistedFirebaseAuthState,
  clearRecentAuthenticatedSessionHint,
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
  clearSessionScopedClientState,
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

  // El listener de auth no conoce el estado vigente: la preservación de la razón
  // de «unauthorized» se decide aquí, con el estado previo a mano. Memoizado:
  // el bootstrap lo usa como dependencia y una identidad nueva por render lo
  // re-suscribía en bucle (OOM en tests).
  const setSessionStatePreservingUnauthorizedReason = useCallback(
    (next: AuthSessionState) =>
      setSessionState(current =>
        shouldPreserveUnauthorizedSessionReason(current, next) ? current : next
      ),
    []
  );
  useInactivityLogout(currentUser, handleLogout);
  // Solo para sesiones plenamente autorizadas con Firebase Auth real: la firma
  // anónima (signature mode) no tiene rol efectivo en las reglas y el usuario
  // de bootstrap E2E no tiene sesión Firebase — en ambos casos las lecturas
  // básicas se deniegan por diseño, no por una sesión perdida.
  useSessionPermissionGuard(
    sessionState.status === 'authorized' && !e2eBootstrapUser ? currentUser : null,
    handleLogout,
    setSessionState
  );
  useResolvedAuthBootstrap({
    e2eBootstrapUser,
    resolveRedirectAuthSessionOutcome: executeRedirectAuthResolution,
    resolveCurrentAuthSessionOutcome: executeResolvedCurrentAuthSessionState,
    onAuthSessionStateChange,
    setSessionState: setSessionStatePreservingUnauthorizedReason,
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
        resetLocationToLoginRoute();
        // Session-scoped Firebase persistence is local to this tab. Clearing
        // browser keys is not enough because Firebase can retain currentUser
        // in memory and emit it again; sign out locally without rebroadcasting.
        void Promise.allSettled([signOut(), clearSessionScopedClientState(message.reason)]);
        // Drop this tab's own persisted auth copy too: with session-scoped
        // Firebase persistence the initiating tab's signOut cannot reach it,
        // so a refresh here would otherwise restore the closed session.
        clearPersistedFirebaseAuthState();
        clearRecentAuthenticatedSessionHint();
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
