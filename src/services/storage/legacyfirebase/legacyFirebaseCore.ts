import type { FirebaseOptions } from 'firebase/app';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Firestore, getFirestore } from 'firebase/firestore';
import { logLegacyError, logLegacyInfo } from './legacyFirebaseLogger';

const LEGACY_FIREBASE_ENV_KEYS = [
  'VITE_LEGACY_FIREBASE_API_KEY',
  'VITE_LEGACY_FIREBASE_AUTH_DOMAIN',
  'VITE_LEGACY_FIREBASE_PROJECT_ID',
  'VITE_LEGACY_FIREBASE_STORAGE_BUCKET',
  'VITE_LEGACY_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_LEGACY_FIREBASE_APP_ID',
] as const;

type LegacyFirebaseEnvKey = (typeof LEGACY_FIREBASE_ENV_KEYS)[number];
type LegacyFirebaseEnvSource = Partial<Record<LegacyFirebaseEnvKey, string | undefined>>;

const LEGACY_FIREBASE_APP_NAME = 'legacy-production';
const BLOCKED_LEGACY_PROJECT_IDS = new Set(['hospital-hanga-roa']);

const readLegacyFirebaseEnv = (): LegacyFirebaseEnvSource =>
  import.meta.env as LegacyFirebaseEnvSource;

const readLegacyFirebaseEnvValue = (
  env: LegacyFirebaseEnvSource,
  key: LegacyFirebaseEnvKey
): string => String(env[key] || '').trim();

export const getMissingLegacyFirebaseConfigKeys = (
  env: LegacyFirebaseEnvSource = readLegacyFirebaseEnv()
): LegacyFirebaseEnvKey[] =>
  LEGACY_FIREBASE_ENV_KEYS.filter(key => readLegacyFirebaseEnvValue(env, key).length === 0);

export const resolveLegacyFirebaseConfig = (
  env: LegacyFirebaseEnvSource = readLegacyFirebaseEnv()
): FirebaseOptions | null => {
  if (getMissingLegacyFirebaseConfigKeys(env).length > 0) {
    return null;
  }

  const projectId = readLegacyFirebaseEnvValue(env, 'VITE_LEGACY_FIREBASE_PROJECT_ID');
  if (BLOCKED_LEGACY_PROJECT_IDS.has(projectId)) {
    return null;
  }

  return {
    apiKey: readLegacyFirebaseEnvValue(env, 'VITE_LEGACY_FIREBASE_API_KEY'),
    authDomain: readLegacyFirebaseEnvValue(env, 'VITE_LEGACY_FIREBASE_AUTH_DOMAIN'),
    projectId,
    storageBucket: readLegacyFirebaseEnvValue(env, 'VITE_LEGACY_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readLegacyFirebaseEnvValue(env, 'VITE_LEGACY_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readLegacyFirebaseEnvValue(env, 'VITE_LEGACY_FIREBASE_APP_ID'),
  };
};

let legacyApp: FirebaseApp | null = null;
let legacyDb: Firestore | null = null;

export const initLegacyFirebase = (): Firestore => {
  if (legacyDb) return legacyDb;

  const legacyConfig = resolveLegacyFirebaseConfig();
  if (!legacyConfig) {
    const missingKeys = getMissingLegacyFirebaseConfigKeys();
    const error = new Error(`Legacy Firebase config is incomplete: ${missingKeys.join(', ')}`);
    logLegacyError('[LegacyFirebase] Missing read-only legacy Firebase config.', error);
    throw error;
  }

  try {
    legacyApp = initializeApp(legacyConfig, LEGACY_FIREBASE_APP_NAME);
    legacyDb = getFirestore(legacyApp);
    logLegacyInfo(
      `[LegacyFirebase] Connected to ${legacyConfig.projectId || 'legacy-project'} (READ-ONLY)`
    );
    return legacyDb;
  } catch (error) {
    logLegacyError('[LegacyFirebase] Failed to connect to production:', error);
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
