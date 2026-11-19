/**
 * Repository Configuration
 * Shared configuration state for repositories.
 * Extracted to avoid circular dependencies between repository modules.
 */

import { isE2ELocalOnlySyncForced } from '@/shared/runtime/e2eRuntime';

export type FirestoreSyncMode = 'enabled' | 'bootstrapping' | 'local_only';

export type FirestoreSyncReason =
  | 'ready'
  | 'auth_loading'
  | 'auth_connecting'
  | 'auth_unavailable'
  | 'manual_override'
  | 'offline'
  | 'runtime_unavailable';

export interface FirestoreSyncState {
  mode: FirestoreSyncMode;
  reason: FirestoreSyncReason;
}

export type RemoteSyncRuntimeStatus = 'ready' | 'bootstrapping' | 'local_only';

export interface RemoteSyncRuntimeState {
  status: RemoteSyncRuntimeStatus;
  reason: FirestoreSyncReason;
}

export interface ResolveRemoteSyncRuntimeStatusInput {
  authLoading: boolean;
  isFirebaseConnected: boolean;
  firestoreSyncState?: FirestoreSyncState;
}

export interface RepositorySyncRuntimeSnapshot {
  firestoreEnabled: boolean;
  firestoreSyncState: FirestoreSyncState;
}

type RepositorySyncRuntimeListener = (snapshot: RepositorySyncRuntimeSnapshot) => void;

const createRepositorySyncRuntimeStore = (initialSnapshot: RepositorySyncRuntimeSnapshot) => {
  let snapshot = initialSnapshot;
  const listeners = new Set<RepositorySyncRuntimeListener>();

  const notify = () => {
    listeners.forEach(listener => listener(snapshot));
  };

  return {
    getSnapshot: (): RepositorySyncRuntimeSnapshot => snapshot,
    setSnapshot(nextSnapshot: RepositorySyncRuntimeSnapshot) {
      snapshot = nextSnapshot;
      notify();
    },
    subscribe(listener: RepositorySyncRuntimeListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const resolveInitialRepositorySyncRuntimeSnapshot = ({
  localOnlyForced,
}: {
  localOnlyForced: boolean;
}): RepositorySyncRuntimeSnapshot =>
  localOnlyForced
    ? {
        firestoreEnabled: false,
        firestoreSyncState: {
          mode: 'local_only',
          reason: 'manual_override',
        },
      }
    : {
        firestoreEnabled: true,
        firestoreSyncState: {
          mode: 'enabled',
          reason: 'ready',
        },
      };

const repositorySyncRuntimeStore = createRepositorySyncRuntimeStore(
  resolveInitialRepositorySyncRuntimeSnapshot({
    localOnlyForced: isE2ELocalOnlySyncForced(),
  })
);

// ============================================================================
// API
// ============================================================================

/**
 * Enable or disable Firestore synchronization.
 * When disabled, only local IndexedDB storage is used.
 */
export const setFirestoreEnabled = (enabled: boolean): void => {
  repositorySyncRuntimeStore.setSnapshot({
    firestoreEnabled: enabled,
    firestoreSyncState: enabled
      ? {
          mode: 'enabled',
          reason: 'ready',
        }
      : {
          mode: 'local_only',
          reason: 'auth_unavailable',
        },
  });
};

/**
 * Check if Firestore synchronization is enabled.
 */
export const isFirestoreEnabled = (): boolean =>
  repositorySyncRuntimeStore.getSnapshot().firestoreEnabled;

export const setFirestoreSyncState = (state: FirestoreSyncState): void => {
  repositorySyncRuntimeStore.setSnapshot({
    firestoreEnabled: state.mode !== 'local_only',
    firestoreSyncState: state,
  });
};

export const getFirestoreSyncState = (): FirestoreSyncState =>
  repositorySyncRuntimeStore.getSnapshot().firestoreSyncState;

export const getRepositorySyncRuntimeSnapshot = (): RepositorySyncRuntimeSnapshot =>
  repositorySyncRuntimeStore.getSnapshot();

export const subscribeToRepositorySyncRuntime = (listener: RepositorySyncRuntimeListener) =>
  repositorySyncRuntimeStore.subscribe(listener);

export const resolveRemoteSyncRuntimeState = ({
  authLoading,
  isFirebaseConnected,
  firestoreSyncState,
}: ResolveRemoteSyncRuntimeStatusInput): RemoteSyncRuntimeState => {
  if (authLoading) {
    return {
      status: 'bootstrapping',
      reason: 'auth_loading',
    };
  }

  if (
    firestoreSyncState?.mode === 'local_only' &&
    firestoreSyncState.reason !== 'auth_unavailable'
  ) {
    return {
      status: 'local_only',
      reason: firestoreSyncState.reason,
    };
  }

  if (isFirebaseConnected) {
    return {
      status: 'ready',
      reason: 'ready',
    };
  }

  if (firestoreSyncState?.mode === 'bootstrapping') {
    return {
      status: 'bootstrapping',
      reason: firestoreSyncState.reason,
    };
  }

  if (firestoreSyncState?.mode === 'enabled') {
    return {
      status: 'bootstrapping',
      reason: firestoreSyncState.reason === 'ready' ? 'auth_connecting' : firestoreSyncState.reason,
    };
  }

  return {
    status: 'local_only',
    reason: firestoreSyncState?.reason || 'auth_unavailable',
  };
};

export const resolveRemoteSyncRuntimeStatus = (
  input: ResolveRemoteSyncRuntimeStatusInput
): RemoteSyncRuntimeStatus => resolveRemoteSyncRuntimeState(input).status;
