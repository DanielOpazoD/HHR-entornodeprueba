import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useUserAvatarProfile } from '@/hooks/useUserAvatarProfile';
import { writeCachedUserAvatarProfile } from '@/services/user-profile/userAvatarProfileService';

const { subscribeProfileMock } = vi.hoisted(() => ({
  subscribeProfileMock: vi.fn(),
}));

vi.mock('@/services/user-profile/userAvatarProfileService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/user-profile/userAvatarProfileService')>();
  return {
    ...actual,
    userAvatarProfileService: {
      subscribeProfile: subscribeProfileMock,
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
    },
  };
});

describe('useUserAvatarProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    subscribeProfileMock.mockReturnValue(vi.fn());
  });

  it('hydrates the first render from the cached in-app avatar profile for the current user', () => {
    writeCachedUserAvatarProfile(
      {
        uid: 'user-1',
        email: 'doctor@hospital.cl',
        photoURL: 'https://storage.test/cached-avatar.png',
        storagePath: 'user-avatars/user-1/avatar',
        updatedAt: '2026-05-30T12:00:00.000Z',
      },
      'user-1'
    );

    const { result } = renderHook(() =>
      useUserAvatarProfile({
        uid: 'user-1',
        email: 'doctor@hospital.cl',
        displayName: 'Doctor',
      } as never)
    );

    expect(result.current.profile?.photoURL).toBe('https://storage.test/cached-avatar.png');
    expect(result.current.isLoading).toBe(true);
  });

  it('ignores stale subscription callbacks after the active user changes', async () => {
    const profileCallbacks: Array<(profile: unknown) => void> = [];
    subscribeProfileMock.mockImplementation((_uid, onProfile) => {
      profileCallbacks.push(onProfile);
      return vi.fn();
    });

    const { result, rerender } = renderHook(
      ({ uid }) =>
        useUserAvatarProfile({
          uid,
          email: `${uid}@hospital.cl`,
          displayName: uid,
        } as never),
      {
        initialProps: { uid: 'user-1' },
      }
    );

    await waitFor(() => expect(profileCallbacks).toHaveLength(1));

    rerender({ uid: 'user-2' });

    await waitFor(() => expect(profileCallbacks).toHaveLength(2));

    act(() => {
      profileCallbacks[0]?.({
        uid: 'user-1',
        email: 'user-1@hospital.cl',
        photoURL: 'https://storage.test/stale-avatar.png',
        storagePath: 'user-avatars/user-1/avatar',
        updatedAt: '2026-05-30T12:00:00.000Z',
      });
    });

    expect(result.current.profile?.uid).not.toBe('user-1');

    act(() => {
      profileCallbacks[1]?.({
        uid: 'user-2',
        email: 'user-2@hospital.cl',
        photoURL: 'https://storage.test/current-avatar.png',
        storagePath: 'user-avatars/user-2/avatar',
        updatedAt: '2026-05-30T12:00:00.000Z',
      });
    });

    expect(result.current.profile?.uid).toBe('user-2');
  });
});
