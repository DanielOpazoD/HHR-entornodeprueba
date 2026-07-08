import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createUserAvatarProfileService,
  readCachedUserAvatarProfile,
} from '@/services/user-profile/userAvatarProfileService';

const repository = {
  getDoc: vi.fn(),
  setDoc: vi.fn(),
};

const storageRef = { fullPath: 'user-avatars/user-1/avatar' };
const storageRuntime = {
  getStorage: vi.fn(),
  loadStorageModule: vi.fn(),
};
const storageModule = {
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
};

const createImageFile = (size = 128) =>
  new File([new Uint8Array(size)], 'foto perfil.png', { type: 'image/png' });

describe('userAvatarProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    repository.getDoc.mockResolvedValue(null);
    storageRuntime.getStorage.mockResolvedValue({ bucket: 'test' });
    storageRuntime.loadStorageModule.mockResolvedValue(storageModule);
    storageModule.ref.mockReturnValue(storageRef);
    storageModule.uploadBytes.mockResolvedValue(undefined);
    storageModule.getDownloadURL.mockResolvedValue(
      'https://storage.test/user-avatars/user-1/avatar?token=abc'
    );
    storageModule.deleteObject.mockResolvedValue(undefined);
  });

  it('uploads an avatar to a stable user-owned path and stores profile metadata in user settings', async () => {
    const service = createUserAvatarProfileService({
      repository,
      storageRuntime,
      now: () => '2026-05-30T12:00:00.000Z',
    });

    const profile = await service.uploadAvatar({
      uid: ' user-1 ',
      email: 'doctor@hospital.cl',
      file: createImageFile(),
    });

    expect(storageModule.ref).toHaveBeenCalledWith(
      { bucket: 'test' },
      'user-avatars/user-1/avatar'
    );
    expect(storageModule.uploadBytes).toHaveBeenCalledWith(storageRef, expect.any(File), {
      contentType: 'image/png',
      customMetadata: {
        module: 'user-profile',
        userId: 'user-1',
      },
    });
    expect(repository.setDoc).toHaveBeenCalledWith(
      'userSettings',
      'user-1',
      {
        userAvatarProfile: {
          uid: 'user-1',
          email: 'doctor@hospital.cl',
          photoURL:
            'https://storage.test/user-avatars/user-1/avatar?token=abc&v=2026-05-30T12%3A00%3A00.000Z',
          storagePath: 'user-avatars/user-1/avatar',
          updatedAt: '2026-05-30T12:00:00.000Z',
        },
      },
      { merge: true }
    );
    expect(profile.photoURL).toContain('v=2026-05-30T12%3A00%3A00.000Z');
    expect(readCachedUserAvatarProfile('user-1')).toEqual(profile);
  });

  it('hydrates and updates the local avatar cache from Firestore subscriptions', () => {
    const subscribeDoc = vi.fn((_collection, _id, onSnapshot: (settings: unknown) => void) => {
      onSnapshot({
        userAvatarProfile: {
          uid: 'user-1',
          email: 'doctor@hospital.cl',
          photoURL: 'https://storage.test/avatar.png',
          storagePath: 'user-avatars/user-1/avatar',
          updatedAt: '2026-05-30T12:00:00.000Z',
        },
      });
      return vi.fn();
    });
    const service = createUserAvatarProfileService({
      repository: { ...repository, subscribeDoc },
      storageRuntime,
    });
    const onProfile = vi.fn();

    service.subscribeProfile(' user-1 ', onProfile);

    expect(onProfile).toHaveBeenCalledWith({
      uid: 'user-1',
      email: 'doctor@hospital.cl',
      photoURL: 'https://storage.test/avatar.png',
      storagePath: 'user-avatars/user-1/avatar',
      updatedAt: '2026-05-30T12:00:00.000Z',
    });
    expect(readCachedUserAvatarProfile('user-1')?.photoURL).toBe('https://storage.test/avatar.png');
  });

  it('rejects non-image avatar files before touching storage', async () => {
    const service = createUserAvatarProfileService({ repository, storageRuntime });
    const file = new File(['text'], 'avatar.txt', { type: 'text/plain' });

    await expect(
      service.uploadAvatar({ uid: 'user-1', email: 'doctor@hospital.cl', file })
    ).rejects.toThrow('Solo se permiten imágenes');

    expect(storageRuntime.loadStorageModule).not.toHaveBeenCalled();
    expect(repository.setDoc).not.toHaveBeenCalled();
  });

  it('falls back to synchronized user settings when Storage rules deny the avatar path', async () => {
    storageModule.uploadBytes.mockRejectedValueOnce({ code: 'storage/unauthorized' });
    const service = createUserAvatarProfileService({
      repository,
      storageRuntime,
      now: () => '2026-05-30T12:00:00.000Z',
    });

    const profile = await service.uploadAvatar({
      uid: 'user-1',
      email: 'doctor@hospital.cl',
      file: createImageFile(),
    });

    expect(storageModule.getDownloadURL).not.toHaveBeenCalled();
    expect(profile.photoURL).toMatch(/^data:image\/png;base64,/);
    expect(profile.storagePath).toBe('firestore:user-avatar:user-1');
    expect(repository.setDoc).toHaveBeenCalledWith(
      'userSettings',
      'user-1',
      {
        userAvatarProfile: {
          uid: 'user-1',
          email: 'doctor@hospital.cl',
          photoURL: expect.stringMatching(/^data:image\/png;base64,/),
          storagePath: 'firestore:user-avatar:user-1',
          updatedAt: '2026-05-30T12:00:00.000Z',
        },
      },
      { merge: true }
    );
  });

  it('removes the stored avatar and clears the profile metadata for the same user', async () => {
    repository.getDoc.mockResolvedValueOnce({
      userAvatarProfile: {
        uid: 'user-1',
        email: 'doctor@hospital.cl',
        photoURL: 'https://storage.test/avatar',
        storagePath: 'user-avatars/user-1/avatar',
        updatedAt: '2026-05-29T12:00:00.000Z',
      },
    });
    const service = createUserAvatarProfileService({ repository, storageRuntime });

    await service.removeAvatar(' user-1 ');

    expect(storageModule.ref).toHaveBeenCalledWith(
      { bucket: 'test' },
      'user-avatars/user-1/avatar'
    );
    expect(storageModule.deleteObject).toHaveBeenCalledWith(storageRef);
    expect(repository.setDoc).toHaveBeenCalledWith(
      'userSettings',
      'user-1',
      { userAvatarProfile: null },
      { merge: true }
    );
    expect(readCachedUserAvatarProfile('user-1')).toBeNull();
  });

  it('clears a Firestore-backed fallback avatar without trying to delete a Storage object', async () => {
    repository.getDoc.mockResolvedValueOnce({
      userAvatarProfile: {
        uid: 'user-1',
        email: 'doctor@hospital.cl',
        photoURL: 'data:image/png;base64,abc',
        storagePath: 'firestore:user-avatar:user-1',
        updatedAt: '2026-05-29T12:00:00.000Z',
      },
    });
    const service = createUserAvatarProfileService({ repository, storageRuntime });

    await service.removeAvatar('user-1');

    expect(storageRuntime.loadStorageModule).not.toHaveBeenCalled();
    expect(repository.setDoc).toHaveBeenCalledWith(
      'userSettings',
      'user-1',
      { userAvatarProfile: null },
      { merge: true }
    );
  });
});
