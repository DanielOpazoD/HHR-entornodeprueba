import { describe, expect, it } from 'vitest';
import {
  getMissingLegacyFirebaseConfigKeys,
  resolveLegacyFirebaseConfig,
} from '@/services/storage/legacyfirebase/legacyFirebaseCore';

const buildLegacyEnv = (
  overrides: Partial<Record<string, string | undefined>> = {}
): Record<string, string | undefined> => ({
  VITE_LEGACY_FIREBASE_API_KEY: 'legacy-api-key',
  VITE_LEGACY_FIREBASE_AUTH_DOMAIN: 'legacy-project.firebaseapp.com',
  VITE_LEGACY_FIREBASE_PROJECT_ID: 'legacy-project',
  VITE_LEGACY_FIREBASE_STORAGE_BUCKET: 'legacy-project.firebasestorage.app',
  VITE_LEGACY_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_LEGACY_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
  ...overrides,
});

describe('legacyFirebaseCore config resolution', () => {
  it('resolves the read-only legacy config from env when all required values exist', () => {
    const config = resolveLegacyFirebaseConfig(buildLegacyEnv());

    expect(config).toEqual({
      apiKey: 'legacy-api-key',
      authDomain: 'legacy-project.firebaseapp.com',
      projectId: 'legacy-project',
      storageBucket: 'legacy-project.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef',
    });
  });

  it('reports missing env keys and returns null when config is incomplete', () => {
    const env = buildLegacyEnv({
      VITE_LEGACY_FIREBASE_API_KEY: ' ',
      VITE_LEGACY_FIREBASE_APP_ID: undefined,
    });

    expect(resolveLegacyFirebaseConfig(env)).toBeNull();
    expect(getMissingLegacyFirebaseConfigKeys(env)).toEqual([
      'VITE_LEGACY_FIREBASE_API_KEY',
      'VITE_LEGACY_FIREBASE_APP_ID',
    ]);
  });

  it('rejects production hospital-hanga-roa as a legacy source for this testing repo', () => {
    expect(
      resolveLegacyFirebaseConfig(
        buildLegacyEnv({
          VITE_LEGACY_FIREBASE_AUTH_DOMAIN: 'hospital-hanga-roa.firebaseapp.com',
          VITE_LEGACY_FIREBASE_PROJECT_ID: 'hospital-hanga-roa',
          VITE_LEGACY_FIREBASE_STORAGE_BUCKET: 'hospital-hanga-roa.firebasestorage.app',
        })
      )
    ).toBeNull();
  });
});
