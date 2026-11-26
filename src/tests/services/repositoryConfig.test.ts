// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  getRepositorySyncRuntimeSnapshot,
  isFirestoreEnabled,
  resolveInitialRepositorySyncRuntimeSnapshot,
  resolveRemoteSyncRuntimeState,
  resolveRemoteSyncRuntimeStatus,
  setFirestoreEnabled,
  setFirestoreSyncState,
  subscribeToRepositorySyncRuntime,
  type FirestoreSyncState,
} from '@/services/repositories/repositoryConfig';

describe('repositoryConfig', () => {
  it('starts local-only when the runtime explicitly forces local sync', () => {
    expect(resolveInitialRepositorySyncRuntimeSnapshot({ localOnlyForced: true })).toEqual({
      firestoreEnabled: false,
      firestoreSyncState: {
        mode: 'local_only',
        reason: 'manual_override',
      },
    });
  });

  it('returns ready when Firebase is connected even if a stale local_only state remains', () => {
    const staleLocalOnlyState: FirestoreSyncState = {
      mode: 'local_only',
      reason: 'auth_unavailable',
    };

    expect(
      resolveRemoteSyncRuntimeStatus({
        authLoading: false,
        isFirebaseConnected: true,
        firestoreSyncState: staleLocalOnlyState,
      })
    ).toBe('ready');
  });

  it('preserves explicit local-only overrides even when Firebase is connected', () => {
    expect(
      resolveRemoteSyncRuntimeState({
        authLoading: false,
        isFirebaseConnected: true,
        firestoreSyncState: {
          mode: 'local_only',
          reason: 'manual_override',
        },
      })
    ).toEqual({
      status: 'local_only',
      reason: 'manual_override',
    });
  });

  it('returns local_only when Firebase is not connected and auth already resolved', () => {
    expect(
      resolveRemoteSyncRuntimeStatus({
        authLoading: false,
        isFirebaseConnected: false,
      })
    ).toBe('local_only');
  });

  it('keeps a bootstrapping reason when auth is resolved but remote runtime is still reconnecting', () => {
    expect(
      resolveRemoteSyncRuntimeState({
        authLoading: false,
        isFirebaseConnected: false,
        firestoreSyncState: {
          mode: 'bootstrapping',
          reason: 'auth_connecting',
        },
      })
    ).toEqual({
      status: 'bootstrapping',
      reason: 'auth_connecting',
    });
  });

  it('surfaces a local_only reason when runtime was degraded by offline mode', () => {
    expect(
      resolveRemoteSyncRuntimeState({
        authLoading: false,
        isFirebaseConnected: false,
        firestoreSyncState: {
          mode: 'local_only',
          reason: 'offline',
        },
      })
    ).toEqual({
      status: 'local_only',
      reason: 'offline',
    });
  });

  it('keeps the shared runtime snapshot in sync with sync-state updates', () => {
    setFirestoreSyncState({
      mode: 'local_only',
      reason: 'offline',
    });

    expect(isFirestoreEnabled()).toBe(false);
    expect(getRepositorySyncRuntimeSnapshot()).toEqual({
      firestoreEnabled: false,
      firestoreSyncState: {
        mode: 'local_only',
        reason: 'offline',
      },
    });

    setFirestoreEnabled(true);
  });

  it('notifies subscribers when the repository sync runtime changes', () => {
    const snapshots: FirestoreSyncState[] = [];
    const unsubscribe = subscribeToRepositorySyncRuntime(snapshot => {
      snapshots.push(snapshot.firestoreSyncState);
    });

    setFirestoreSyncState({
      mode: 'bootstrapping',
      reason: 'auth_connecting',
    });

    unsubscribe();
    setFirestoreEnabled(true);

    expect(snapshots).toEqual([
      {
        mode: 'bootstrapping',
        reason: 'auth_connecting',
      },
    ]);
  });
});
