import type { Auth } from 'firebase/auth';
import type { FirebaseStorage } from 'firebase/storage';
import {
  defaultFirebaseConfigRuntimeAdapter,
  type FirebaseConfigRuntimeAdapter,
} from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

export interface BackupStorageRuntime {
  auth: Auth;
  ready: Promise<unknown>;
  getStorage: () => Promise<FirebaseStorage>;
}

export const createBackupStorageRuntime = (
  adapter: FirebaseConfigRuntimeAdapter = defaultFirebaseConfigRuntimeAdapter
): BackupStorageRuntime => ({
  get auth() {
    return adapter.getAuth();
  },
  ready: adapter.ready,
  getStorage: () => adapter.getStorage(),
});

export const defaultBackupStorageRuntime: BackupStorageRuntime = createBackupStorageRuntime();
