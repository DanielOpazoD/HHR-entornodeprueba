import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandleLogout } from '@/hooks/useAuthStateSessionSupport';
import {
  readCachedUserAvatarProfile,
  writeCachedUserAvatarProfile,
} from '@/services/user-profile/userAvatarProfileCache';

vi.mock('@/application/ports/auditPort', () => ({
  defaultAuditPort: {
    logUserLogout: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/config/queryClient', () => ({
  clearQueryCache: vi.fn(),
}));

vi.mock('@/services/auth/authBroadcastChannel', () => ({
  broadcastLogout: vi.fn(),
}));

vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn().mockResolvedValue(undefined),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

describe('createHandleLogout avatar cache cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clears cached avatar profiles synchronously during logout', async () => {
    writeCachedUserAvatarProfile(
      {
        uid: 'u1',
        email: 'doctor@hospital.cl',
        photoURL: 'https://storage.test/avatar.png',
        storagePath: 'user-avatars/u1/avatar',
        updatedAt: '2026-05-30T12:00:00.000Z',
      },
      'u1'
    );

    const signOut = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    const handleLogout = createHandleLogout(
      {
        uid: 'u1',
        email: 'doctor@hospital.cl',
        displayName: 'Doctor',
        role: 'admin',
      },
      signOut,
      setSessionState
    );

    await handleLogout('manual');

    expect(readCachedUserAvatarProfile('u1')).toBeNull();
    expect(signOut).toHaveBeenCalled();
    expect(setSessionState).toHaveBeenCalledWith({ status: 'unauthenticated', user: null });
  });
});
