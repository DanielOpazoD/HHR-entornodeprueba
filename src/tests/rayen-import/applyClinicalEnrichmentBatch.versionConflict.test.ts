import { describe, expect, it, vi } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = {
  date: '2026-07-28',
  lastUpdated: '2026-07-28T10:00:00.000Z',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  meta: { revision: 7 },
} as unknown as DailyRecord;

const operations: ClinicalFillPatchOperation[] = [
  {
    target: {
      censusDate: '2026-07-28',
      bedId: 'H2C1',
      clinicalEpisodeId: 'episode-1',
    },
    patch: {
      'beds.H2C1.evaluationScores': { braden: { total: 17 } },
      'beds.H2C1.clinicalSyncCheckpoint': { version: 1, sources: {} },
    },
  },
];

const dependencies = () => ({
  applyPatch: vi.fn().mockResolvedValue(undefined),
  refreshRecord: vi.fn().mockResolvedValue(record),
  rebuildOperations: vi.fn(() => operations),
  invoke: vi.fn().mockImplementation(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
    success: true,
    authorityStatus: 'ok' as const,
    date: payload.date,
    mode: payload.mode,
    targetCount: payload.patches.length,
    fieldCount:
      payload.patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
      (payload.checkpoints?.length ?? 0),
    resultParity: 'matched' as const,
    patientWrites: 1,
    historySnapshots: 1,
  })),
  createMutationId: vi.fn(() => 'mutation-fixed'),
});

describe('applyClinicalEnrichmentBatch version conflicts', () => {
  it('rehydrates and rebuilds the first clinical batch after the census revision advances', async () => {
    const deps = dependencies();
    deps.refreshRecord.mockResolvedValue({
      ...record,
      lastUpdated: '2026-07-28T10:01:00.000Z',
      meta: { revision: 8 },
    });
    deps.invoke.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'revision_mismatch: expected 7, received 8.',
    });

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-first-import',
      operations,
      ...deps,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[0]?.[0]).toMatchObject({
      baseRevision: 7,
      expectedLastUpdated: '2026-07-28T10:00:00.000Z',
    });
    expect(deps.invoke.mock.calls[1]?.[0]).toMatchObject({
      baseRevision: 8,
      expectedLastUpdated: '2026-07-28T10:01:00.000Z',
      mutationId: 'mutation-fixed',
    });
    expect(deps.refreshRecord).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ patientWrites: 1, retries: 1 });
  });

  it('keeps a changed bed or episode blocked after refreshing a stale census revision', async () => {
    const deps = dependencies();
    deps.refreshRecord.mockResolvedValue({
      ...record,
      lastUpdated: '2026-07-28T10:01:00.000Z',
      meta: { revision: 8 },
    });
    deps.invoke
      .mockRejectedValueOnce({
        code: 'functions/aborted',
        message: 'version_mismatch: the daily record changed before clinical enrichment.',
      })
      .mockRejectedValueOnce({
        code: 'functions/failed-precondition',
        message: 'Clinical enrichment target episode no longer matches the census.',
      });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-moved-patient',
        operations,
        ...deps,
      })
    ).rejects.toMatchObject({
      code: 'functions/failed-precondition',
      clinicalBatchRetries: 1,
    });

    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('does not retry an unrelated aborted authority rejection', async () => {
    const deps = dependencies();
    deps.invoke.mockRejectedValue({
      code: 'functions/aborted',
      message: 'The transaction was cancelled by policy.',
    });

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-policy-abort',
        operations,
        ...deps,
      })
    ).rejects.toMatchObject({ code: 'functions/aborted' });

    expect(deps.invoke).toHaveBeenCalledTimes(1);
    expect(deps.refreshRecord).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});
