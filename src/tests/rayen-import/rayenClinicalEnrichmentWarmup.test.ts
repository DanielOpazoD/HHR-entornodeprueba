import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmRayenClinicalEnrichmentBatch } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';

const mocks = vi.hoisted(() => ({ getRegionalFunctions: vi.fn() }));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: mocks.getRegionalFunctions },
}));

// A stand-in for the SDK's Functions instance: the real SDK starts a background IndexedDB
// heartbeat that outlives the test. The warm-up uses the instance's own resolver (`_url`).
const regionalFunctions = (origin: string) => (region: string) => ({
  region,
  _url: (name: string) => `${origin}/${region}/${name}`,
});

describe('clinical batch warm-up', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends one bare preflight to the address the callable itself resolves', async () => {
    mocks.getRegionalFunctions.mockImplementation(async (region: string) =>
      regionalFunctions('https://functions.example')(region)
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await warmRayenClinicalEnrichmentBatch();

    expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith('southamerica-east1');
    // No body, no Authorization and no payload: the server only answers the CORS preflight.
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://functions.example/southamerica-east1/applyRayenClinicalEnrichmentBatch',
      { method: 'OPTIONS' }
    );
  });

  it('settles quietly when the browser refuses the OPTIONS request after its preflight', async () => {
    mocks.getRegionalFunctions.mockImplementation(async (region: string) =>
      regionalFunctions('https://functions.example')(region)
    );
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends nothing when the SDK instance exposes no address resolver', async () => {
    mocks.getRegionalFunctions.mockResolvedValue({ region: 'southamerica-east1' });

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the Functions runtime is unavailable', async () => {
    mocks.getRegionalFunctions.mockRejectedValue(
      new Error('Firebase app instance is not available yet.')
    );

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
