import { FirebaseApp, initializeApp } from 'firebase/app';
import { Firestore, getFirestore } from 'firebase/firestore';

const LEGACY_CONFIG = {
  apiKey: 'AIzaSyB0MKYu-efNbYEZnyTy7KHqWVQvBVwozwM',
  authDomain: 'hospital-hanga-roa.firebaseapp.com',
  projectId: 'hospital-hanga-roa',
  storageBucket: 'hospital-hanga-roa.firebasestorage.app',
  messagingSenderId: '955583524000',
  appId: '1:955583524000:web:78384874fe6c4a08d82dc5',
};

let legacyApp: FirebaseApp | null = null;
let legacyDb: Firestore | null = null;

export const initLegacyFirebase = (): Firestore => {
  if (legacyDb) return legacyDb;

  try {
    legacyApp = initializeApp(LEGACY_CONFIG, 'legacy-production');
    legacyDb = getFirestore(legacyApp);
    console.log('[LegacyFirebase] ✅ Connected to hospital-hanga-roa (READ-ONLY)');
    return legacyDb;
  } catch (error) {
    console.error('[LegacyFirebase] ❌ Failed to connect to production:', error);
    throw error;
  }
};

export const getLegacyDb = (): Firestore | null => {
  if (!legacyDb) {
    try {
      return initLegacyFirebase();
    } catch {
      return null;
    }
  }
  return legacyDb;
};

export const isLegacyAvailable = (): boolean => legacyDb !== null;
