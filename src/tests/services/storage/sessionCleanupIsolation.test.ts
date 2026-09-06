import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { clearSyncQueueForOwner } from '@/services/storage/sync';
import {
  clearSessionScopedClientState,
  getStoredSessionOwnerKey,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  getSessionGeneration,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  clearAllRecords: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/storage/sync', () => ({
  clearSyncQueueForOwner: vi.fn().mockResolvedValue(undefined),
  recordSyncQueueOwnershipTelemetry: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

describe('session cleanup isolation', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await clearSessionScopedClientState('manual');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setSessionGeneration(null);
  });

  it('does not admit a new owner while the previous cleanup is pending', async () => {
    localStorage.setItem('hhr_session_owner_v1', 'user:old');
    let finishCleanup!: () => void;
    vi.mocked(clearAllRecords).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishCleanup = resolve;
        })
    );
    const cleanup = clearSessionScopedClientState('manual');
    let admitted = false;
    const admission = reconcileAuthorizedSessionOwner('user:new').then(() => {
      admitted = true;
      localStorage.setItem('hhr_new_session_data', 'keep');
    });
    // Let the competing admission reach its first asynchronous boundary.
    await new Promise(resolve => setTimeout(resolve, 0));
    const admittedBeforeCleanup = admitted;
    finishCleanup();
    await Promise.all([cleanup, admission]);
    expect(admittedBeforeCleanup).toBe(false);
    expect(getStoredSessionOwnerKey()).toBe('user:new');
    expect(localStorage.getItem('hhr_new_session_data')).toBe('keep');
  });

  it('attempts the remaining cleanup when the record store rejects', async () => {
    localStorage.setItem('hhr_session_owner_v1', 'user:old');
    localStorage.setItem('hhr_private', 'old');
    sessionStorage.setItem('hhr_private', 'old');
    vi.mocked(clearAllRecords).mockRejectedValueOnce(new Error('store unavailable'));
    await clearSessionScopedClientState('manual').catch(() => undefined);
    expect(clearSyncQueueForOwner).toHaveBeenCalledWith('user:old', true);
    expect(localStorage.getItem('hhr_private')).toBeNull();
    expect(sessionStorage.getItem('hhr_private')).toBeNull();
  });

  it('still attempts Firebase logout when Web Storage is blocked', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    sessionStorage.setItem('hhr_private', 'old');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(clearSessionScopedClientState('manual', signOut)).rejects.toThrow('blocked');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearAllRecords).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(sessionStorage.getItem('hhr_private')).toBeNull();
  });

  it('attempts every backend when writing the cleanup marker fails', async () => {
    await reconcileAuthorizedSessionOwner('user:old');
    sessionStorage.setItem('hhr_private', 'old');
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'hhr_session_cleanup_pending_v1') throw new Error('quota');
      write.call(this, key, value);
    });
    const signOut = vi.fn().mockResolvedValue(undefined);
    await expect(clearSessionScopedClientState('manual', signOut)).rejects.toThrow('quota');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearAllRecords).toHaveBeenCalledTimes(1);
    expect(clearSyncQueueForOwner).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('hhr_private')).toBeNull();
  });

  it('reports a failed local closure without deleting another document’s generation', async () => {
    await reconcileAuthorizedSessionOwner('user:old');
    localStorage.setItem('hhr_session_generation_v1', 'replacement');
    localStorage.setItem('hhr_new_session_data', 'keep');
    const signOut = vi.fn().mockRejectedValue(new Error('auth unavailable'));
    await expect(clearSessionScopedClientState('manual', signOut)).rejects.toThrow();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearAllRecords).not.toHaveBeenCalled();
    expect(localStorage.getItem('hhr_new_session_data')).toBe('keep');
  });

  it('does not claim a shared generation before this document has admitted its owner', async () => {
    localStorage.setItem('hhr_session_owner_v1', 'user:replacement');
    localStorage.setItem('hhr_session_generation_v1', 'replacement');
    localStorage.setItem('hhr_new_session_data', 'keep');
    sessionStorage.setItem('hhr_private', 'old');
    const signOut = vi.fn().mockResolvedValue(undefined);
    await clearSessionScopedClientState('manual', signOut);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearAllRecords).not.toHaveBeenCalled();
    expect(getStoredSessionOwnerKey()).toBe('user:replacement');
    expect(localStorage.getItem('hhr_new_session_data')).toBe('keep');
    expect(sessionStorage.getItem('hhr_private')).toBeNull();
  });

  it('retries failed local auth closure without admitting its stale authorized event', async () => {
    await reconcileAuthorizedSessionOwner('user:old');
    const signOut = vi
      .fn()
      .mockRejectedValueOnce(new Error('auth unavailable'))
      .mockResolvedValue(undefined);
    await expect(clearSessionScopedClientState('manual', signOut)).rejects.toThrow();
    await expect(reconcileAuthorizedSessionOwner('user:old')).rejects.toThrow('authenticate again');
    expect(signOut).toHaveBeenCalledTimes(2);
    await reconcileAuthorizedSessionOwner('user:new');
    expect(getStoredSessionOwnerKey()).toBe('user:new');
  });

  it('serializes two independent document runtimes through the shared browser lock', async () => {
    let lockTail: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      const result = lockTail.then(callback);
      lockTail = result.catch(() => undefined);
      return result;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    vi.resetModules();
    const tabA = await import('@/services/storage/sessionScopedStorageService');
    vi.resetModules();
    const tabB = await import('@/services/storage/sessionScopedStorageService');
    await tabA.reconcileAuthorizedSessionOwner('user:old');
    let finish!: () => void;
    const closing = tabA.clearSessionScopedClientState(
      'manual',
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    let admitted = false;
    const opening = tabB.reconcileAuthorizedSessionOwner('user:new').then(() => {
      admitted = true;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(admitted).toBe(false);
    finish();
    await Promise.all([closing, opening]);
    expect(getStoredSessionOwnerKey()).toBe('user:new');
    expect(request).toHaveBeenCalledWith('hhr-session-storage-transition', expect.any(Function));
  });

  it('does not publish an owner after failed cleanup and retries before admission', async () => {
    await reconcileAuthorizedSessionOwner('user:old');
    vi.mocked(clearAllRecords).mockRejectedValueOnce(new Error('store unavailable'));
    await expect(clearSessionScopedClientState('manual')).rejects.toThrow();
    expect(getStoredSessionOwnerKey()).toBe('user:old');
    await reconcileAuthorizedSessionOwner('user:new');
    expect(clearAllRecords).toHaveBeenCalledTimes(2);
    expect(getStoredSessionOwnerKey()).toBe('user:new');
  });

  it('clears shared records once for two queued closures of the same generation', async () => {
    await reconcileAuthorizedSessionOwner('user:old');
    await Promise.all([
      clearSessionScopedClientState('manual'),
      clearSessionScopedClientState('manual'),
    ]);
    expect(clearAllRecords).toHaveBeenCalledTimes(1);
  });

  it('ignores a queued old closure after the same user starts a new generation', async () => {
    await reconcileAuthorizedSessionOwner('user:same');
    const oldGeneration = getSessionGeneration();
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner('user:same');
    expect(getSessionGeneration()).not.toBe(oldGeneration);
    const signOut = vi.fn();
    localStorage.setItem('hhr_new_session_data', 'keep');
    await clearSessionScopedClientState('manual', signOut, oldGeneration);
    expect(signOut).not.toHaveBeenCalled();
    expect(clearAllRecords).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('hhr_new_session_data')).toBe('keep');
  });

  it('waits for local Firebase closure as well as storage before admitting a user', async () => {
    await reconcileAuthorizedSessionOwner('user:old');
    let finish!: () => void;
    const closing = clearSessionScopedClientState(
      'manual',
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const admission = reconcileAuthorizedSessionOwner('user:new');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getStoredSessionOwnerKey()).toBe('user:old');
    finish();
    await Promise.all([closing, admission]);
    expect(getStoredSessionOwnerKey()).toBe('user:new');
  });
});
