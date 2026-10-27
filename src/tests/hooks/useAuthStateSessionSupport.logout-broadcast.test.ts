import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandleLogout } from '@/hooks/useAuthStateSessionSupport';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import {
  getSessionGeneration,
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { preserveSessionSyncQueue } from '@/services/storage/sessionSyncQueuePreservation';
import { clearSyncQueueForOwner } from '@/services/storage/sync';

vi.mock('@/application/ports/auditPort', () => ({
  defaultAuditPort: { logUserLogout: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/config/queryClient', () => ({ clearQueryCache: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  clearAllRecords: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/storage/sync', () => ({
  clearSyncQueueForOwner: vi.fn().mockResolvedValue(undefined),
  recordSyncQueueOwnershipTelemetry: vi.fn(),
}));
vi.mock('@/services/storage/sessionSyncQueuePreservation', () => ({
  preserveSessionSyncQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

describe('createHandleLogout when the cross-tab channel fails', () => {
  const ownerKey = 'user:hhrn_synthetic';
  const persistedAuthKey = 'firebase:authUser:synthetic-key:synthetic-app';
  const postMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hhr_session_owner_v1', ownerKey);
    localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-generation');
    localStorage.setItem(persistedAuthKey, '{}');
    sessionStorage.setItem('hhr_logged_this_session', 'true');
    setSessionGeneration('synthetic-generation');
    postMessage.mockImplementation(() => {
      throw new DOMException('Channel is closed', 'InvalidStateError');
    });
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage = postMessage;
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionGeneration(null);
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each(['manual', 'automatic'] as const)(
    'still closes Firebase and cleans the %s session while preserving nursing work',
    async reason => {
      const signOut = vi.fn().mockResolvedValue(undefined);
      const setSessionState = vi.fn();
      const logout = createHandleLogout(
        {
          uid: 'hhrn_synthetic',
          email: 'synthetic@example.test',
          displayName: 'Synthetic nurse',
          role: 'nurse_hospital',
        },
        signOut,
        setSessionState
      );

      await expect(logout(reason)).resolves.toBeUndefined();

      expect(postMessage).toHaveBeenCalledOnce();
      expect(signOut).toHaveBeenCalledOnce();
      expect(setSessionState).toHaveBeenCalledWith({ status: 'unauthenticated', user: null });
      expect(getStoredSessionOwnerKey()).toBeNull();
      expect(getSessionGeneration()).toBeNull();
      expect(localStorage.getItem(SESSION_GENERATION_KEY)).toBeNull();
      expect(localStorage.getItem(persistedAuthKey)).toBeNull();
      expect(sessionStorage.getItem('hhr_logged_this_session')).toBeNull();
      expect(preserveSessionSyncQueue).toHaveBeenCalledExactlyOnceWith(ownerKey);
      expect(clearSyncQueueForOwner).not.toHaveBeenCalled();
    }
  );
});
