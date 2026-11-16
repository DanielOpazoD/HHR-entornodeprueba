import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmRayenClinicalEnrichmentBatch } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';

const mocks = vi.hoisted(() => ({ getRegionalFunctions: vi.fn() }));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: mocks.getRegionalFunctions },
}));

// Real SDK instances: the warm-up must reach the address the callable itself uses.
describe('clinical batch warm-up', () => {
  let app: FirebaseApp;
  const fetchMock = vi.fn();

  beforeEach(() => {
    app = initializeApp(
      { projectId: 'demo-hhr-warmup', apiKey: 'synthetic-key', appId: 'synthetic-app' },
      `warmup-${Math.random()}`
    );
    mocks.getRegionalFunctions.mockImplementation(async (region: string) =>
      getFunctions(app, region)
    );
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await deleteApp(app);
  });

  it('sends one bare preflight to the regional callable and nothing else', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await warmRayenClinicalEnrichmentBatch();

    expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith('southamerica-east1');
    // No body, no Authorization and no payload: the server only answers the CORS preflight.
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://southamerica-east1-demo-hhr-warmup.cloudfunctions.net/applyRayenClinicalEnrichmentBatch',
      { method: 'OPTIONS' }
    );
  });

  it('targets the emulator when the app is connected to it', async () => {
    mocks.getRegionalFunctions.mockImplementation(async (region: string) => {
      const functions = getFunctions(app, region);
      connectFunctionsEmulator(functions, '127.0.0.1', 5611);
      return functions;
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await warmRayenClinicalEnrichmentBatch();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://127.0.0.1:5611/demo-hhr-warmup/southamerica-east1/applyRayenClinicalEnrichmentBatch',
      { method: 'OPTIONS' }
    );
  });

  it('settles quietly when the browser refuses the OPTIONS request after its preflight', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends nothing when the Functions runtime is unavailable', async () => {
    mocks.getRegionalFunctions.mockRejectedValue(
      new Error('Firebase app instance is not available yet.')
    );

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
