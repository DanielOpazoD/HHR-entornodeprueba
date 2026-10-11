import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callRayenClinicalEnrichmentBatch,
  type RayenClinicalEnrichmentBatchPayload,
} from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';

const mocks = vi.hoisted(() => ({
  regionalInstance: { region: 'southamerica-east1' },
  getRegionalFunctions: vi.fn(),
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getRegionalFunctions: mocks.getRegionalFunctions,
    getFunctions: mocks.getFunctions,
  },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));

const payload: RayenClinicalEnrichmentBatchPayload = {
  date: '2026-09-30',
  authorityDate: '2026-09-30',
  runId: 'synthetic-run',
  mutationId: 'synthetic-mutation',
  expectedLastUpdated: '2026-09-30T12:00:00.000Z',
  baseRevision: 2,
  fieldContractVersion: 2,
  mode: 'enforced',
  patches: [],
};

describe('clinical batch regional client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getRegionalFunctions.mockResolvedValue(mocks.regionalInstance);
    mocks.httpsCallable.mockReturnValue(mocks.invoke);
  });

  it('uses the deployed regional runtime and preserves the payload and existing timeout', async () => {
    const response = {
      success: true,
      date: payload.date,
      mode: payload.mode,
      authorityStatus: 'idempotent',
      targetCount: 0,
      fieldCount: 0,
    };
    mocks.invoke.mockResolvedValue({ data: response });

    await expect(callRayenClinicalEnrichmentBatch(payload)).resolves.toBe(response);
    expect(mocks.getRegionalFunctions).toHaveBeenCalledExactlyOnceWith('southamerica-east1');
    expect(mocks.httpsCallable).toHaveBeenCalledExactlyOnceWith(
      mocks.regionalInstance,
      'applyRayenClinicalEnrichmentBatch',
      { timeout: 20_000 }
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(payload);
    expect(mocks.invoke.mock.calls[0][0]).toBe(payload);
    expect(mocks.getFunctions).not.toHaveBeenCalled();
  });

  it.each(['functions/deadline-exceeded', 'functions/permission-denied', 'functions/aborted'])(
    'preserves %s without a second-region fallback or an extra invocation',
    async code => {
      const error = { code, message: 'synthetic rejection' };
      mocks.invoke.mockRejectedValue(error);

      await expect(callRayenClinicalEnrichmentBatch(payload)).rejects.toBe(error);
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
      expect(mocks.httpsCallable).toHaveBeenCalledTimes(1);
      expect(mocks.getRegionalFunctions).toHaveBeenCalledTimes(1);
      expect(mocks.getFunctions).not.toHaveBeenCalled();
    }
  );

  it('does not invoke or fall back when regional initialization fails', async () => {
    const error = new Error('synthetic initialization failure');
    mocks.getRegionalFunctions.mockRejectedValue(error);

    await expect(callRayenClinicalEnrichmentBatch(payload)).rejects.toBe(error);
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.getFunctions).not.toHaveBeenCalled();
  });
});
