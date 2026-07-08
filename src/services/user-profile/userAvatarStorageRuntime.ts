import type { FirebaseStorage } from 'firebase/storage';
import { defaultStorageRuntime } from '@/services/firebase-runtime/storageRuntime';

type FirebaseStorageModule = Pick<
  typeof import('firebase/storage'),
  'deleteObject' | 'getDownloadURL' | 'ref' | 'uploadBytes'
>;

export interface UserAvatarStorageRuntime {
  getStorage: () => Promise<FirebaseStorage>;
  loadStorageModule: () => Promise<FirebaseStorageModule>;
}

let storageModulePromise: Promise<FirebaseStorageModule> | null = null;

export const loadUserAvatarStorageModule = (): Promise<FirebaseStorageModule> => {
  storageModulePromise ??= import('firebase/storage')
    .then(module => ({
      deleteObject: module.deleteObject,
      getDownloadURL: module.getDownloadURL,
      ref: module.ref,
      uploadBytes: module.uploadBytes,
    }))
    .catch(error => {
      storageModulePromise = null;
      throw error;
    });
  return storageModulePromise;
};

export const defaultUserAvatarStorageRuntime: UserAvatarStorageRuntime = {
  getStorage: defaultStorageRuntime.getStorage,
  loadStorageModule: loadUserAvatarStorageModule,
};
