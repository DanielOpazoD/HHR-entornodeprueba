import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser, UserRole } from '@/types/authRoleTypes';
import {
  createAuthenticatingAuthSessionState,
  createUnauthenticatedAuthSessionState,
  getAuthSessionStateUser,
  toResolvedAuthSessionState,
} from '@/services/auth/authSessionState';
import {
  buildAuthRuntimeSnapshot,
  type AuthRuntimeSnapshot,
} from '@/services/auth/authRuntimeSnapshot';
import { buildAuthRemoteSyncState } from '@/services/auth/authRemoteSyncState';
import {
  resolveRemoteSyncRuntimeState,
  type FirestoreSyncReason,
  type FirestoreSyncState,
  type FirestoreSyncMode,
  type RemoteSyncRuntimeStatus,
} from '@/services/repositories/repositoryConfig';
import { canEditAnyAppModule } from '@/shared/access/operationalAccessPolicy';
import { isUserRole } from '@/shared/access/roleAccessMatrix';

type AuthSignOutHandler = (reason?: 'manual' | 'automatic') => Promise<void>;

export interface NormalizeAuthOperationalStateInput {
  sessionState?: AuthSessionState | null;
  currentUser?: AuthUser | null;
  authorizedUser?: AuthUser | null;
  authLoading?: boolean;
  isFirebaseConnected?: boolean;
  isOnline?: boolean;
  remoteSyncStatus?: RemoteSyncRuntimeStatus | null;
  remoteSyncState?: FirestoreSyncState | null;
  authRuntime?: AuthRuntimeSnapshot | null;
  role?: UserRole | null;
  handleLogout?: AuthSignOutHandler | null;
}

export interface NormalizedAuthOperationalState {
  sessionState: AuthSessionState;
  currentUser: AuthUser | null;
  authorizedUser: AuthUser | null;
  authLoading: boolean;
  isFirebaseConnected: boolean;
  remoteSyncStatus: RemoteSyncRuntimeStatus;
  remoteSyncState: FirestoreSyncState;
  authRuntime: AuthRuntimeSnapshot;
  role: UserRole;
  isEditor: boolean;
  isViewer: boolean;
  handleLogout: AuthSignOutHandler;
}

const VALID_FIRESTORE_SYNC_MODES = new Set<FirestoreSyncMode>([
  'enabled',
  'bootstrapping',
  'local_only',
]);

const VALID_FIRESTORE_SYNC_REASONS = new Set<FirestoreSyncReason>([
  'ready',
  'auth_loading',
  'auth_connecting',
  'auth_unavailable',
  'manual_override',
  'offline',
  'runtime_unavailable',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAuthUser = (value: unknown): value is AuthUser =>
  isRecord(value) &&
  typeof value.uid === 'string' &&
  ('email' in value ? value.email === null || typeof value.email === 'string' : true) &&
  ('displayName' in value
    ? value.displayName === null || typeof value.displayName === 'string'
    : true);

const isAuthSessionState = (value: unknown): value is AuthSessionState => {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return false;
  }

  switch (value.status) {
    case 'authorized':
    case 'anonymous_signature':
      return isAuthUser(value.user);
    case 'auth_error':
      return (
        value.user === null && isRecord(value.error) && typeof value.error.message === 'string'
      );
    case 'unauthenticated':
    case 'authenticating':
    case 'unauthorized':
      return value.user === null;
    default:
      return false;
  }
};

const isFirestoreSyncState = (value: unknown): value is FirestoreSyncState =>
  isRecord(value) &&
  typeof value.mode === 'string' &&
  VALID_FIRESTORE_SYNC_MODES.has(value.mode as FirestoreSyncMode) &&
  typeof value.reason === 'string' &&
  VALID_FIRESTORE_SYNC_REASONS.has(value.reason as FirestoreSyncReason);

const isAuthRuntimeSnapshot = (value: unknown): value is AuthRuntimeSnapshot =>
  isRecord(value) &&
  typeof value.sessionStatus === 'string' &&
  typeof value.authLoading === 'boolean' &&
  typeof value.isFirebaseConnected === 'boolean' &&
  typeof value.isOnline === 'boolean' &&
  typeof value.bootstrapPending === 'boolean' &&
  typeof value.pendingAgeMs === 'number' &&
  isRecord(value.budgetProfile) &&
  typeof value.timeoutMs === 'number' &&
  typeof value.runtimeState === 'string' &&
  Array.isArray(value.issues);

const getDefaultOnlineState = (): boolean =>
  typeof navigator === 'undefined' ? true : navigator.onLine;

const noopSignOut: AuthSignOutHandler = async () => {};

const resolveSessionState = (
  input: Pick<
    NormalizeAuthOperationalStateInput,
    'sessionState' | 'currentUser' | 'authorizedUser' | 'authLoading'
  >
): AuthSessionState => {
  if (isAuthSessionState(input.sessionState)) {
    return input.sessionState;
  }

  const fallbackUser = isAuthUser(input.currentUser)
    ? input.currentUser
    : isAuthUser(input.authorizedUser)
      ? input.authorizedUser
      : null;

  if (fallbackUser) {
    return toResolvedAuthSessionState(fallbackUser);
  }

  if (input.authLoading) {
    return createAuthenticatingAuthSessionState();
  }

  return createUnauthenticatedAuthSessionState();
};

export const resolveNormalizedAuthOperationalState = (
  input: NormalizeAuthOperationalStateInput
): NormalizedAuthOperationalState => {
  const sessionState = resolveSessionState(input);
  const currentUser = getAuthSessionStateUser(sessionState);
  const authorizedUser = sessionState.status === 'authorized' ? sessionState.user : null;
  const authLoading = input.authLoading ?? sessionState.status === 'authenticating';
  const isFirebaseConnected = input.isFirebaseConnected ?? false;
  const isOnline = input.isOnline ?? getDefaultOnlineState();
  const remoteSyncState = isFirestoreSyncState(input.remoteSyncState)
    ? input.remoteSyncState
    : buildAuthRemoteSyncState({
        sessionState,
        authLoading,
        isFirebaseConnected,
        isOnline,
      });
  const remoteSyncStatus = resolveRemoteSyncRuntimeState({
    authLoading,
    isFirebaseConnected,
    firestoreSyncState: remoteSyncState,
  }).status;
  const authRuntime = isAuthRuntimeSnapshot(input.authRuntime)
    ? input.authRuntime
    : buildAuthRuntimeSnapshot({
        sessionState,
        authLoading,
        isFirebaseConnected,
        isOnline,
      });
  const role = isUserRole(input.role) ? input.role : currentUser?.role || 'viewer';
  const isEditor = canEditAnyAppModule(role);

  return {
    sessionState,
    currentUser,
    authorizedUser,
    authLoading,
    isFirebaseConnected,
    remoteSyncStatus,
    remoteSyncState,
    authRuntime,
    role,
    isEditor,
    isViewer: !isEditor,
    handleLogout: input.handleLogout || noopSignOut,
  };
};
