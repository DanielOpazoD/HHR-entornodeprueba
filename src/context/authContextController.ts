import type { NormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import type { UseAuthStateReturn } from '@/hooks/useAuthState';
import type { NormalizeAuthOperationalStateInput } from '@/services/auth/authOperationalState';
import type { AuthUser, UserRole } from '@/types/authRoleTypes';
import { isAuthenticatedAuthSessionState } from '@/services/auth/authSessionState';

export const buildNormalizedAuthOperationalStateInput = (
  authState: Pick<
    UseAuthStateReturn,
    | 'sessionState'
    | 'currentUser'
    | 'authorizedUser'
    | 'authLoading'
    | 'isFirebaseConnected'
    | 'remoteSyncStatus'
    | 'remoteSyncState'
    | 'authRuntime'
    | 'role'
    | 'handleLogout'
  >
): NormalizeAuthOperationalStateInput => ({
  sessionState: authState.sessionState,
  currentUser: authState.currentUser,
  authorizedUser: authState.authorizedUser,
  authLoading: authState.authLoading,
  isFirebaseConnected: authState.isFirebaseConnected,
  remoteSyncStatus: authState.remoteSyncStatus,
  remoteSyncState: authState.remoteSyncState,
  authRuntime: authState.authRuntime,
  role: authState.role,
  handleLogout: authState.handleLogout,
});

export interface AuthContextType {
  sessionState: NormalizedAuthOperationalState['sessionState'];
  authRuntime: NormalizedAuthOperationalState['authRuntime'];
  currentUser: AuthUser | null;
  authorizedUser: AuthUser | null;
  user: AuthUser | null;
  role: UserRole;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAuthorizedSession: boolean;
  isAnonymousSignature: boolean;
  isUnauthorized: boolean;
  isEditor: boolean;
  isViewer: boolean;
  isFirebaseConnected: boolean;
  remoteSyncStatus: NormalizedAuthOperationalState['remoteSyncStatus'];
  remoteSyncState: NormalizedAuthOperationalState['remoteSyncState'];
  signOut: NormalizedAuthOperationalState['handleLogout'];
  logoutPrompt?: UseAuthStateReturn['logoutPrompt'];
}

export const buildAuthContextValue = (
  normalizedAuthState: NormalizedAuthOperationalState,
  logoutPrompt: UseAuthStateReturn['logoutPrompt'] = null
): AuthContextType => ({
  sessionState: normalizedAuthState.sessionState,
  authRuntime: normalizedAuthState.authRuntime,
  currentUser: normalizedAuthState.currentUser,
  authorizedUser: normalizedAuthState.authorizedUser,
  user: normalizedAuthState.currentUser,
  role: normalizedAuthState.role,
  isLoading: normalizedAuthState.authLoading,
  isAuthenticated: isAuthenticatedAuthSessionState(normalizedAuthState.sessionState),
  isAuthorizedSession: normalizedAuthState.sessionState.status === 'authorized',
  isAnonymousSignature: normalizedAuthState.sessionState.status === 'anonymous_signature',
  isUnauthorized: normalizedAuthState.sessionState.status === 'unauthorized',
  isEditor: normalizedAuthState.isEditor,
  isViewer: normalizedAuthState.isViewer,
  isFirebaseConnected: normalizedAuthState.isFirebaseConnected,
  remoteSyncStatus: normalizedAuthState.remoteSyncStatus,
  remoteSyncState: normalizedAuthState.remoteSyncState,
  signOut: normalizedAuthState.handleLogout,
  logoutPrompt,
});
