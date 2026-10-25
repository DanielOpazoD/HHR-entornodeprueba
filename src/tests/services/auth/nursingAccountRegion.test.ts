import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  defaultFunctions: { region: 'us-central1' },
  regionalFunctions: { region: 'southamerica-west1' },
  getFunctions: vi.fn(),
  getRegionalFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
  recordTelemetry: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: mocks.recordTelemetry,
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: mocks.getFunctions,
    getRegionalFunctions: mocks.getRegionalFunctions,
  },
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({ defaultAuthRuntime: {} }));
vi.mock('@/services/auth/authRoleLookup', () => ({ clearRecentAuthRoleLookups: vi.fn() }));

import { callAccount, accountErrorMessage } from '@/services/auth/nursingAccountService';
import { loadFunctionsModule } from '@/services/firebase-runtime/functionsModuleLoader';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

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

  const credentials = { rut: '111111111', password: 'synthetic-password' };
  const functionsError = (code: string) => Object.assign(new Error(code), { code });

  it.each([
    ['southamerica-west1', 'signInWithRutSantiago', 'functions/internal'],
    ['southamerica-west1', 'signInWithRutSantiago', 'functions/unavailable'],
    ['southamerica-west1', 'signInWithRutSantiago', 'functions/deadline-exceeded'],
    ['southamerica-east1', 'signInWithRut', 'functions/internal'],
  ])(
    'retries sign-in once in US after %s (%s) answers %s and records the fallback',
    async (region, callableName, code) => {
      vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', region);
      mocks.invoke
        .mockRejectedValueOnce(functionsError(code))
        .mockResolvedValueOnce({ data: { credentialEmail: 'uid@accounts.hhr.invalid' } });

      await expect(callAccount('signInWithRut', credentials)).resolves.toEqual({
        credentialEmail: 'uid@accounts.hhr.invalid',
      });

      expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith(region);
      expect(mocks.getFunctions).toHaveBeenCalledOnce();
      expect(mocks.httpsCallable.mock.calls).toEqual([
        [mocks.regionalFunctions, callableName, { timeout: 60000 }],
        [mocks.defaultFunctions, 'signInWithRut', { timeout: 60000 }],
      ]);
      expect(mocks.invoke.mock.calls).toEqual([[credentials], [credentials]]);
      expect(mocks.recordTelemetry).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          category: 'auth',
          operation: 'rut_sign_in_region_fallback',
          status: 'degraded',
          runtimeState: 'recoverable',
          context: expect.objectContaining({ region, errorCode: code }),
        })
      );
      expect(mocks.recordTelemetry.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.getFunctions.mock.invocationCallOrder[0]
      );
      expect(JSON.stringify(mocks.recordTelemetry.mock.calls)).not.toMatch(
        /111111111|synthetic-password/
      );
      // What actually leaves the device: the privacy allowlist must keep operation, region and code.
      const [event] = mocks.recordTelemetry.mock.calls[0];
      expect(
        sanitizeOperationalTelemetryEvent({ ...event, timestamp: '2026-10-22T22:05:00.000Z' })
      ).toMatchObject({
        category: 'auth',
        status: 'degraded',
        operation: 'rut_sign_in_region_fallback',
        runtimeState: 'recoverable',
        issues: [code === 'functions/deadline-exceeded' ? 'timeout_issue' : 'unavailable_issue'],
        context: { region, errorCode: code, isOnline: true },
        droppedContextKeys: [],
      });
    }
  );

  it('surfaces the US answer when the fallback also fails', async () => {
    const rejection = functionsError('functions/permission-denied');
    mocks.invoke.mockRejectedValueOnce(functionsError('functions/internal'));
    mocks.invoke.mockRejectedValueOnce(rejection);

    await expect(callAccount('signInWithRut', credentials)).rejects.toBe(rejection);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.recordTelemetry).toHaveBeenCalledOnce();
  });

  it('sends the sign-in to US only once even when US has no usable answer either', async () => {
    const usFailure = functionsError('functions/internal');
    mocks.invoke
      .mockRejectedValueOnce(functionsError('functions/internal'))
      .mockRejectedValueOnce(usFailure)
      .mockResolvedValue({ data: { credentialEmail: 'uid@accounts.hhr.invalid' } });

    await expect(callAccount('signInWithRut', credentials)).rejects.toBe(usFailure);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.getFunctions).toHaveBeenCalledOnce();
    expect(mocks.recordTelemetry).toHaveBeenCalledOnce();
  });

  it('still falls back when recording the telemetry throws', async () => {
    mocks.recordTelemetry.mockImplementation(() => {
      throw new Error('synthetic-telemetry-failure');
    });
    mocks.invoke
      .mockRejectedValueOnce(functionsError('functions/internal'))
      .mockResolvedValueOnce({ data: { credentialEmail: 'uid@accounts.hhr.invalid' } });

    await expect(callAccount('signInWithRut', credentials)).resolves.toEqual({
      credentialEmail: 'uid@accounts.hhr.invalid',
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    ...['southamerica-west1', 'southamerica-east1'].flatMap(region =>
      [
        functionsError('functions/permission-denied'),
        functionsError('functions/resource-exhausted'),
        functionsError('functions/invalid-argument'),
        new Error('synthetic-uncoded'),
      ].map(error => [region, error] as const)
    ),
    ['us-central1', functionsError('functions/internal')] as const,
  ])(
    'propagates a %s rejection without sending the sign-in elsewhere: %s',
    async (region, error) => {
      vi.stubEnv('VITE_ACCOUNT_FUNCTIONS_REGION', region);
      mocks.invoke.mockRejectedValue(error);
      await expect(callAccount('signInWithRut', credentials)).rejects.toBe(error);
      expect(mocks.invoke).toHaveBeenCalledOnce();
      expect(mocks.httpsCallable).toHaveBeenCalledOnce();
      expect(mocks.recordTelemetry).not.toHaveBeenCalled();
      if (region === 'us-central1') {
        expect(mocks.getFunctions).toHaveBeenCalledOnce();
        expect(mocks.getRegionalFunctions).not.toHaveBeenCalled();
      } else {
        expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith(region);
        expect(mocks.getFunctions).not.toHaveBeenCalled();
      }
    }
  );

  it('never moves other account operations to another endpoint after a transport failure', async () => {
    const error = functionsError('functions/internal');
    mocks.invoke.mockRejectedValue(error);
    await expect(callAccount('changeNursingPassword', credentials)).rejects.toBe(error);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.getRegionalFunctions).not.toHaveBeenCalled();
    expect(mocks.recordTelemetry).not.toHaveBeenCalled();
  });
});

describe('nursing account error messages', () => {
  afterEach(() => vi.restoreAllMocks());
  it('explains offline RUT login and nursing account failures before mapping callable codes', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    for (const error of [{ code: 'functions/unavailable' }, new Error('synthetic failure')]) {
      expect(accountErrorMessage(error)).toMatch(/sin conexión/i);
      expect(accountErrorMessage(error)).not.toMatch(/recuperación por correo|administrador/i);
    }
  });
  it('preserves the recovery service message when online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(accountErrorMessage({ code: 'functions/unavailable' })).toContain(
      'recuperación por correo'
    );
  });
});

it('directs RUT login to reload during sticky module recovery and clears that message on success', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  try {
    await loadFunctionsModule(() =>
      Promise.reject(new TypeError("'text/html' is not a valid JavaScript MIME type."))
    ).catch(() => {});
    expect(accountErrorMessage({ code: 'functions/unavailable' })).toMatch(
      /Recarga la aplicación.*acceso/
    );
    expect(accountErrorMessage({ code: 'functions/unavailable' })).not.toMatch(
      /correo|administrador/
    );
    await loadFunctionsModule();
    expect(accountErrorMessage({ code: 'functions/unavailable' })).toMatch(
      /recuperación por correo/
    );
  } finally {
    await loadFunctionsModule();
    vi.restoreAllMocks();
  }
});
