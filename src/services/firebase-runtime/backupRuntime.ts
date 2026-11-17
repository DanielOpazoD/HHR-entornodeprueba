import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import {
  defaultFirebaseConfigRuntimeAdapter,
  type FirebaseConfigRuntimeAdapter,
} from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

export interface BackupFirestoreRuntime {
  auth: Auth;
  db: Firestore;
}

export interface BackupStorageRuntime {
  auth: Auth;
  ready: Promise<unknown>;
  getStorage: () => Promise<FirebaseStorage>;
}

export const createBackupFirestoreRuntime = (
  adapter: FirebaseConfigRuntimeAdapter = defaultFirebaseConfigRuntimeAdapter
): BackupFirestoreRuntime => ({
  get auth() {
    return adapter.getAuth();
  },
  get db() {
    return adapter.getDb();
  },
});

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
