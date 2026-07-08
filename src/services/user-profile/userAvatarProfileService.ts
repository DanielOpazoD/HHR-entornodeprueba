import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  defaultUserAvatarStorageRuntime,
  type UserAvatarStorageRuntime,
} from '@/services/user-profile/userAvatarStorageRuntime';
import {
  normalizeUserAvatarUid,
  readCachedUserAvatarProfile,
  writeCachedUserAvatarProfile,
  type UserAvatarProfile,
} from '@/services/user-profile/userAvatarProfileCache';

export { readCachedUserAvatarProfile, writeCachedUserAvatarProfile };
export type { UserAvatarProfile };

export const USER_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export interface UserAvatarUploadInput {
  uid: string;
  email?: string | null;
  file: File;
}

interface UserSettingsDocument {
  userAvatarProfile?: Partial<UserAvatarProfile> | null;
}

interface UserAvatarRepository {
  getDoc: IDatabaseProvider['getDoc'];
  setDoc: IDatabaseProvider['setDoc'];
  subscribeDoc?: IDatabaseProvider['subscribeDoc'];
}

interface UserAvatarProfileServiceDependencies {
  repository?: UserAvatarRepository;
  storageRuntime?: UserAvatarStorageRuntime;
  now?: () => string;
}

const USER_SETTINGS_COLLECTION = 'userSettings';
export const buildUserAvatarStoragePath = (uid: string): string =>
  `user-avatars/${normalizeUserAvatarUid(uid)}/avatar`;

const buildFirestoreBackedAvatarPath = (uid: string): string => `firestore:user-avatar:${uid}`;

const appendVersionToUrl = (url: string, version: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
};

const parseProfile = (
  uid: string,
  value: Partial<UserAvatarProfile> | null | undefined
): UserAvatarProfile | null => {
  const photoURL = String(value?.photoURL || '').trim();
  const storagePath = String(value?.storagePath || '').trim();
  if (!photoURL || !storagePath) {
    return null;
  }

  return {
    uid,
    email: String(value?.email || ''),
    photoURL,
    storagePath,
    updatedAt: String(value?.updatedAt || ''),
  };
};

const assertValidAvatarFile = (file: File): void => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Solo se permiten imágenes PNG, JPG o WEBP.');
  }
  if (file.size > USER_AVATAR_MAX_BYTES) {
    throw new Error('La imagen supera el límite de 2MB.');
  }
};

const isObjectNotFoundError = (error: unknown): boolean => {
  const code = String((error as { code?: string })?.code || '');
  return code.includes('object-not-found');
};

const isStorageUnauthorizedError = (error: unknown): boolean => {
  const code = String((error as { code?: string })?.code || '');
  return code.includes('storage/unauthorized') || code.includes('unauthorized');
};

const isFirestoreBackedAvatarPath = (storagePath: string): boolean =>
  storagePath.startsWith('firestore:user-avatar:');

const blobToDataUrl = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo preparar la foto de perfil.'));
    reader.readAsDataURL(file);
  });
};

export const createUserAvatarProfileService = ({
  repository = firestoreDb,
  storageRuntime = defaultUserAvatarStorageRuntime,
  now = () => new Date().toISOString(),
}: UserAvatarProfileServiceDependencies = {}) => {
  const getProfile = async (uid: string): Promise<UserAvatarProfile | null> => {
    const normalizedUid = normalizeUserAvatarUid(uid);
    if (!normalizedUid) {
      return null;
    }

    if (!isFirestoreEnabled()) {
      return readCachedUserAvatarProfile(normalizedUid);
    }

    const settings = await repository.getDoc<UserSettingsDocument>(
      USER_SETTINGS_COLLECTION,
      normalizedUid
    );
    const profile = parseProfile(normalizedUid, settings?.userAvatarProfile);
    writeCachedUserAvatarProfile(profile, normalizedUid);
    return profile;
  };

  return {
    getProfile,

    subscribeProfile(
      uid: string,
      onProfile: (profile: UserAvatarProfile | null) => void,
      onError?: (error: unknown) => void
    ): () => void {
      const normalizedUid = normalizeUserAvatarUid(uid);
      if (!normalizedUid || !isFirestoreEnabled() || !repository.subscribeDoc) {
        void getProfile(normalizedUid)
          .then(onProfile)
          .catch(error => onError?.(error));
        return () => {};
      }

      try {
        return repository.subscribeDoc<UserSettingsDocument>(
          USER_SETTINGS_COLLECTION,
          normalizedUid,
          settings => {
            const profile = parseProfile(normalizedUid, settings?.userAvatarProfile);
            writeCachedUserAvatarProfile(profile, normalizedUid);
            onProfile(profile);
          }
        );
      } catch (error) {
        onError?.(error);
        return () => {};
      }
    },

    async uploadAvatar(input: UserAvatarUploadInput): Promise<UserAvatarProfile> {
      const uid = normalizeUserAvatarUid(input.uid);
      if (!uid) {
        throw new Error('No se pudo identificar al usuario actual.');
      }
      assertValidAvatarFile(input.file);

      const storage = await storageRuntime.getStorage();
      const storageModule = await storageRuntime.loadStorageModule();
      const storagePath = buildUserAvatarStoragePath(uid);
      const storageRef = storageModule.ref(storage, storagePath);
      const updatedAt = now();
      let profile: UserAvatarProfile;

      try {
        await storageModule.uploadBytes(storageRef, input.file, {
          contentType: input.file.type,
          customMetadata: {
            module: 'user-profile',
            userId: uid,
          },
        });

        const downloadUrl = await storageModule.getDownloadURL(storageRef);
        profile = {
          uid,
          email: String(input.email || '').trim(),
          photoURL: appendVersionToUrl(downloadUrl, updatedAt),
          storagePath,
          updatedAt,
        };
      } catch (error) {
        if (!isStorageUnauthorizedError(error)) {
          throw error;
        }

        profile = {
          uid,
          email: String(input.email || '').trim(),
          photoURL: await blobToDataUrl(input.file),
          storagePath: buildFirestoreBackedAvatarPath(uid),
          updatedAt,
        };
      }

      if (!isFirestoreEnabled()) {
        writeCachedUserAvatarProfile(profile, uid);
        return profile;
      }

      await repository.setDoc<UserSettingsDocument>(
        USER_SETTINGS_COLLECTION,
        uid,
        { userAvatarProfile: profile },
        { merge: true }
      );
      writeCachedUserAvatarProfile(profile, uid);
      return profile;
    },

    async removeAvatar(uidInput: string): Promise<void> {
      const uid = normalizeUserAvatarUid(uidInput);
      if (!uid) {
        return;
      }

      const profile = await getProfile(uid);
      if (profile?.storagePath && !isFirestoreBackedAvatarPath(profile.storagePath)) {
        const storage = await storageRuntime.getStorage();
        const storageModule = await storageRuntime.loadStorageModule();
        const storageRef = storageModule.ref(storage, profile.storagePath);
        try {
          await storageModule.deleteObject(storageRef);
        } catch (error) {
          if (!isObjectNotFoundError(error)) {
            throw error;
          }
        }
      }

      if (!isFirestoreEnabled()) {
        writeCachedUserAvatarProfile(null, uid);
        return;
      }

      await repository.setDoc<UserSettingsDocument>(
        USER_SETTINGS_COLLECTION,
        uid,
        { userAvatarProfile: null },
        { merge: true }
      );
      writeCachedUserAvatarProfile(null, uid);
    },
  };
};

export const userAvatarProfileService = createUserAvatarProfileService();
