import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { FirebaseStorage } from 'firebase/storage';

import * as firebaseConfig from '@/firebaseConfig';

export interface FirebaseConfigRuntimeAdapter {
  ready: Promise<unknown>;
  readyFirestore: Promise<unknown>;
  getApp: () => FirebaseApp;
  getOptionalApp: () => FirebaseApp | null;
  getAuth: () => Auth;
  getOptionalAuth: () => Auth | null;
  getDb: () => Firestore;
  getOptionalDb: () => Firestore | null;
  getFunctions: () => Promise<Functions>;
  getRegionalFunctions: (region: string) => Promise<Functions>;
  getStorage: () => Promise<FirebaseStorage>;
}

const resolveReadyPromise = (): Promise<unknown> =>
  'firebaseReady' in firebaseConfig
    ? (firebaseConfig as { firebaseReady: Promise<unknown> }).firebaseReady
    : Promise.resolve();

const resolveFirestoreReadyPromise = (): Promise<unknown> =>
  'firestoreReady' in firebaseConfig
    ? (firebaseConfig as { firestoreReady: Promise<unknown> }).firestoreReady
    : resolveReadyPromise();

export const createFirebaseConfigRuntimeAdapter = (
  overrides: Partial<FirebaseConfigRuntimeAdapter> = {}
): FirebaseConfigRuntimeAdapter => ({
  ready: resolveReadyPromise(),
  readyFirestore: resolveFirestoreReadyPromise(),
  getApp: () => {
    const app = (firebaseConfig as { app?: FirebaseApp }).app;
    if (!app) {
      throw new Error('Firebase app instance is not available yet.');
    }
    return app;
  },
  getOptionalApp: () => (firebaseConfig as { app?: FirebaseApp }).app ?? null,
  getAuth: () => {
    const auth = (firebaseConfig as { auth?: Auth }).auth;
    if (!auth) {
      throw new Error('Auth instance is not available yet.');
    }
    return auth;
  },
  getOptionalAuth: () => (firebaseConfig as { auth?: Auth }).auth ?? null,
  getDb: () => {
    const db = (firebaseConfig as { db?: Firestore }).db;
    if (!db) {
      throw new Error('Firestore instance is not available yet.');
    }
    return db;
  },
  getOptionalDb: () => (firebaseConfig as { db?: Firestore }).db ?? null,
  getFunctions: () => firebaseConfig.getFunctionsInstance(),
  getRegionalFunctions: region => firebaseConfig.getRegionalFunctionsInstance(region),
  getStorage: () => firebaseConfig.getStorageInstance(),
  ...overrides,
});

export const defaultFirebaseConfigRuntimeAdapter = createFirebaseConfigRuntimeAdapter();
