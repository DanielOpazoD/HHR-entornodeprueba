import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAccountFunctions } = require('../../../functions/lib/accounts/accountFunctions.js');
const { SUPPORTED_REGIONS } = require('firebase-functions/v1');

afterEach(() => vi.unstubAllEnvs());

describe('RUT callable regional deployment binding', () => {
  it('preserves the existing US endpoint and adds a supported Gen1 region near Firestore', () => {
    const { signInWithRut } = createAccountFunctions({});
    expect(signInWithRut.__endpoint).toMatchObject({
      platform: 'gcfv1',
      region: ['us-central1', 'southamerica-east1'],
      timeoutSeconds: 60,
      maxInstances: 10,
      secretEnvironmentVariables: [],
      callableTrigger: {},
    });
    expect(SUPPORTED_REGIONS).toContain('southamerica-east1');
    expect(SUPPORTED_REGIONS).not.toContain('southamerica-west1');
  });

  it.each(['demo-hhr-account-regions', 'hhr-pruebas'])(
    'retains the Gen1 service identity in the Santiago declaration for %s',
    projectId => {
      vi.stubEnv('GCLOUD_PROJECT', projectId);
      const { signInWithRutSantiago } = createAccountFunctions({});
      expect(signInWithRutSantiago.__endpoint).toMatchObject({
        platform: 'gcfv2',
        region: ['southamerica-west1'],
        serviceAccountEmail: `${projectId}@appspot.gserviceaccount.com`,
        availableMemoryMb: 256,
        cpu: 'gcf_gen1',
        concurrency: 1,
        minInstances: 0,
        maxInstances: 10,
        timeoutSeconds: 60,
        httpsTrigger: {},
      });
    }
  );

  it('keeps all other account endpoints and recovery secrets in their existing region', () => {
    vi.stubEnv('GCLOUD_PROJECT', 'demo-hhr-account-regions');
    const endpoints = createAccountFunctions({});
    for (const name of Object.keys(endpoints)) {
      if (name === 'signInWithRut' || name === 'signInWithRutSantiago') continue;
      const callable = endpoints[name];
      expect(callable.__endpoint.region, name).toBeUndefined();
      expect(callable.__endpoint.timeoutSeconds, name).toBe(60);
      expect(callable.__endpoint.maxInstances, name).toBe(10);
      expect(callable.__endpoint.serviceAccountEmail, name).not.toBeTypeOf('string');
    }
    expect(endpoints.deliverNursingPasswordRecovery.__endpoint.secretEnvironmentVariables).toEqual([
      { key: 'GMAIL_CLIENT_ID' },
      { key: 'GMAIL_CLIENT_SECRET' },
      { key: 'GMAIL_REFRESH_TOKEN' },
    ]);
  });
});
