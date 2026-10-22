import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  defaultFunctions: { region: 'us-central1' },
  regionalFunctions: { region: 'southamerica-west1' },
  getFunctions: vi.fn(),
  getRegionalFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: mocks.getFunctions,
    getRegionalFunctions: mocks.getRegionalFunctions,
  },
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({ defaultAuthRuntime: {} }));
vi.mock('@/services/auth/authRoleLookup', () => ({ clearRecentAuthRoleLookups: vi.fn() }));

import { callAccount } from '@/services/auth/nursingAccountService';

describe('RUT callable regional rollout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'hhr-pruebas');
    vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', undefined);
    mocks.getFunctions.mockResolvedValue(mocks.defaultFunctions);
    mocks.getRegionalFunctions.mockResolvedValue(mocks.regionalFunctions);
    mocks.httpsCallable.mockReturnValue(mocks.invoke);
    mocks.invoke.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, ''])('defaults only hhr-pruebas to Santiago with flag %j', async flag => {
    vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', flag);
    const data = { rut: '111111111' };
    await expect(callAccount('signInWithRut', data)).resolves.toEqual({ ok: true });
    expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith('southamerica-west1');
    expect(mocks.getFunctions).not.toHaveBeenCalled();
    expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(
      mocks.regionalFunctions,
      'signInWithRutSantiago',
      { timeout: 60000 }
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(data);
  });

  it.each([undefined, '', 'demo-hhr', 'hhr-oficial', 'hhr-pruebas-copy'])(
    'preserves US by default for project %j',
    async projectId => {
      vi.stubEnv('VITE_FIREBASE_PROJECT_ID', projectId);
      await callAccount('signInWithRut');
      expect(mocks.getFunctions).toHaveBeenCalledOnce();
      expect(mocks.getRegionalFunctions).not.toHaveBeenCalled();
      expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(
        mocks.defaultFunctions,
        'signInWithRut',
        { timeout: 60000 }
      );
      expect(mocks.invoke).toHaveBeenCalledOnce();
    }
  );

  it.each(['us-central1', 'unsupported-region', 'southamerica-west2', 'https://example.invalid'])(
    'uses US when explicitly requested or an invalid region is supplied: %j',
    async region => {
      vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', region);
      await callAccount('signInWithRut');
      expect(mocks.getFunctions).toHaveBeenCalledOnce();
      expect(mocks.getRegionalFunctions).not.toHaveBeenCalled();
      expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(
        mocks.defaultFunctions,
        'signInWithRut',
        { timeout: 60000 }
      );
    }
  );

  it.each([
    ['southamerica-east1', 'signInWithRut'],
    ['southamerica-west1', 'signInWithRutSantiago'],
  ])('respects explicit region %s and its callable name', async (region, callableName) => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-hhr');
    vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', region);
    await callAccount('signInWithRut');
    expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith(region);
    expect(mocks.getFunctions).not.toHaveBeenCalled();
    expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(
      mocks.regionalFunctions,
      callableName,
      { timeout: 60000 }
    );
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it.each([
    'createNursingAccount',
    'listNursingAccounts',
    'manageNursingAccount',
    'enableIndividualAccounts',
    'activateNursingAccount',
    'requestNursingPasswordRecovery',
    'resetNursingPassword',
    'changeNursingPassword',
  ])('preserves the existing route for %s under every regional flag', async name => {
    for (const region of [undefined, 'us-central1', 'southamerica-east1', 'southamerica-west1']) {
      vi.clearAllMocks();
      vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', region);
      await callAccount(name);
      expect(mocks.getFunctions).toHaveBeenCalledOnce();
      expect(mocks.getRegionalFunctions).not.toHaveBeenCalled();
      expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(mocks.defaultFunctions, name, {
        timeout: 60000,
      });
      expect(mocks.invoke).toHaveBeenCalledOnce();
    }
  });

  it.each(['us-central1', 'southamerica-east1', 'southamerica-west1'])(
    'propagates a %s failure without retrying the credential operation elsewhere',
    async region => {
      vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', region);
      const error = new Error('synthetic-unavailable');
      mocks.invoke.mockRejectedValue(error);
      await expect(callAccount('signInWithRut')).rejects.toBe(error);
      expect(mocks.invoke).toHaveBeenCalledOnce();
      expect(mocks.httpsCallable).toHaveBeenCalledOnce();
      if (region === 'us-central1') {
        expect(mocks.getFunctions).toHaveBeenCalledOnce();
        expect(mocks.getRegionalFunctions).not.toHaveBeenCalled();
      } else {
        expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith(region);
        expect(mocks.getFunctions).not.toHaveBeenCalled();
      }
    }
  );
});
