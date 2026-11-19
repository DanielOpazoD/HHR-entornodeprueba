import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS,
  warmRayenClinicalEnrichmentBatch,
} from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';

const mocks = vi.hoisted(() => ({
  regionalInstance: { region: 'southamerica-east1' },
  getRegionalFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: mocks.getRegionalFunctions },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));

describe('clinical batch warm-up', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getRegionalFunctions.mockResolvedValue(mocks.regionalInstance);
    mocks.httpsCallable.mockReturnValue(mocks.invoke);
  });

  it('calls the clinical save callable with only the warm-up marker', async () => {
    mocks.invoke.mockResolvedValue({ data: { warmed: true } });

    await warmRayenClinicalEnrichmentBatch();

    expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith('southamerica-east1');
    expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(
      mocks.regionalInstance,
      'applyRayenClinicalEnrichmentBatch',
      { timeout: RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS }
    );
    // Exactly the marker the server recognizes: no patient data, date or contract stamp.
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith({ warmup: true });
  });

  it('settles quietly when the server refuses the warm-up', async () => {
    mocks.invoke.mockRejectedValue(
      Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' })
    );

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it('sends nothing when the Functions runtime is unavailable', async () => {
    mocks.getRegionalFunctions.mockRejectedValue(
      new Error('Firebase app instance is not available yet.')
    );

    await expect(warmRayenClinicalEnrichmentBatch()).resolves.toBeUndefined();
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
  });
});
