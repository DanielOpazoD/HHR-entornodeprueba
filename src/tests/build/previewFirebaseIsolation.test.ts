// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadPreviewFirebaseConfig } from '../../../e2e/fixtures/previewFirebase';

describe('e2e previewFirebase isolation', () => {
  it('defaults to synthetic demo-hhr-e2e coordinates when no demo env is provided', () => {
    expect(loadPreviewFirebaseConfig({})).toEqual({
      apiKey: 'demo-api-key',
      authDomain: 'demo-hhr.firebaseapp.com',
      projectId: 'demo-hhr-e2e',
      storageBucket: 'demo-hhr-e2e.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef123456',
    });
  });

  it('ignores non-demo Firebase environment variables so preview tests never point at production', () => {
    expect(
      loadPreviewFirebaseConfig({
        VITE_FIREBASE_API_KEY: 'live-api-key-example',
        VITE_FIREBASE_PROJECT_ID: 'hhr-pruebas',
        VITE_FIREBASE_AUTH_DOMAIN: 'hhr-pruebas.firebaseapp.com',
        VITE_FIREBASE_STORAGE_BUCKET: 'hhr-pruebas.firebasestorage.app',
        VITE_FIREBASE_APP_ID: '1:9999:web:live',
      })
    ).toEqual({
      apiKey: 'demo-api-key',
      authDomain: 'demo-hhr.firebaseapp.com',
      projectId: 'demo-hhr-e2e',
      storageBucket: 'demo-hhr-e2e.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef123456',
    });
  });

  it('accepts explicit synthetic demo-* coordinates when provided via env', () => {
    expect(
      loadPreviewFirebaseConfig({
        VITE_FIREBASE_API_KEY: 'demo-custom-key',
        VITE_FIREBASE_PROJECT_ID: 'demo-custom-e2e',
      })
    ).toEqual({
      apiKey: 'demo-custom-key',
      authDomain: 'demo-custom-e2e.firebaseapp.com',
      projectId: 'demo-custom-e2e',
      storageBucket: 'demo-custom-e2e.firebasestorage.app',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef123456',
    });
  });
});
