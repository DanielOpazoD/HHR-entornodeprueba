import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  HOSPITAL_CAPACITY,
  HOSPITAL_ID,
  ensureFirebaseProjectRuntimeEnv,
  resolveFirebaseProjectId,
} = require('../../../functions/lib/runtime/runtimeConfig.js');
const { assertSupportedHospitalId } = require('../../../functions/lib/runtime/hospitalPolicy.js');

describe('functions runtimeConfig', () => {
  const originalGcloudProject = process.env.GCLOUD_PROJECT;
  const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalGcpProject = process.env.GCP_PROJECT;
  const originalFirebaseConfig = process.env.FIREBASE_CONFIG;
  const originalStorageBucket = process.env.STORAGE_BUCKET;
  const restoreEnv = (key: string, value: string | undefined) => {
    if (typeof value === 'undefined') {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  };

  afterEach(() => {
    restoreEnv('GCLOUD_PROJECT', originalGcloudProject);
    restoreEnv('GOOGLE_CLOUD_PROJECT', originalGoogleCloudProject);
    restoreEnv('GCP_PROJECT', originalGcpProject);
    restoreEnv('FIREBASE_CONFIG', originalFirebaseConfig);
    restoreEnv('STORAGE_BUCKET', originalStorageBucket);
  });

  it('falls back to the testing Firebase project when runtime project env is absent', () => {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    delete process.env.FIREBASE_CONFIG;

    expect(resolveFirebaseProjectId()).toBe('hhr-pruebas');
  });

  it('sets GCLOUD_PROJECT and FIREBASE_CONFIG for Firebase Functions v1 triggers', () => {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    delete process.env.FIREBASE_CONFIG;

    expect(ensureFirebaseProjectRuntimeEnv()).toBe('hhr-pruebas');
    expect(process.env.GCLOUD_PROJECT).toBe('hhr-pruebas');
    expect(JSON.parse(process.env.FIREBASE_CONFIG || '{}')).toMatchObject({
      projectId: 'hhr-pruebas',
      storageBucket: 'hhr-pruebas.firebasestorage.app',
    });
  });

  it('preserves an explicit runtime project', () => {
    process.env.GCLOUD_PROJECT = 'custom-project';
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'config-project' });

    expect(ensureFirebaseProjectRuntimeEnv()).toBe('custom-project');
    expect(process.env.GCLOUD_PROJECT).toBe('custom-project');
    expect(JSON.parse(process.env.FIREBASE_CONFIG)).toMatchObject({
      projectId: 'config-project',
    });
  });

  it('exposes a bounded default hospital runtime context', () => {
    expect(typeof HOSPITAL_ID).toBe('string');
    expect(HOSPITAL_ID.length).toBeGreaterThan(0);
    expect(HOSPITAL_CAPACITY).toBeGreaterThan(0);
  });

  it('rejects unsupported hospital ids', () => {
    expect(assertSupportedHospitalId(HOSPITAL_ID)).toBe(HOSPITAL_ID);
    expect(() => assertSupportedHospitalId('other-hospital')).toThrow(/Unsupported hospitalId/);
  });
});
