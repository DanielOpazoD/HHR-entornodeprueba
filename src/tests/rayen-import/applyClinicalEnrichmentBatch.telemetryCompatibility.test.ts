import { describe, expect, it } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import { createDependencies, operations, record } from './applyClinicalEnrichmentBatch.fixtures';

describe('applyClinicalEnrichmentBatch telemetry compatibility', () => {
  it('labels a previous-day authority call as historical', async () => {
    const deps = createDependencies();
    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      authorityDate: '2026-07-29',
      runId: 'run-historical',
      operations,
      ...deps,
    });

    expect(result.persistence).toEqual({
      scope: 'historical',
      callableAttempts: 1,
      clientRetries: 0,
      transactionRetries: 0,
    });
  });

  it('keeps aggregate retries after an older callable succeeds without transaction telemetry', async () => {
    const deps = createDependencies();
    deps.invoke
      .mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockImplementationOnce(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
        success: true,
        authorityStatus: 'ok' as const,
        date: payload.date,
        mode: payload.mode,
        targetCount: new Set(
          [...payload.patches, ...(payload.checkpoints ?? [])].map(
            target => `${target.bedId}|${target.clinicalCrib ? 'crib' : 'patient'}`
          )
        ).size,
        fieldCount:
          payload.patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
          (payload.checkpoints?.length ?? 0),
        resultParity: 'matched' as const,
        patientWrites: 1,
        historySnapshots: 1,
      }));

    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-old-callable-retry',
      operations,
      ...deps,
    });

    expect(result).toMatchObject({ retries: 1, patientWrites: 1 });
    expect(result).not.toHaveProperty('persistence');
    expect(deps.invoke).toHaveBeenCalledTimes(2);
  });
});
