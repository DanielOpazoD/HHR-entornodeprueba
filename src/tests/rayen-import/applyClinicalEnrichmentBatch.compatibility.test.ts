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
    target: { censusDate: record.date, bedId: 'H2C1', clinicalEpisodeId: 'episode-1' },
    patch: {
      'beds.H2C1.evaluationScores': { braden: { total: 17 } },
      'beds.H2C1.clinicalSyncCheckpoint': { version: 1, sources: {} },
    },
  },
  {
    target: { censusDate: record.date, bedId: 'H2C2', clinicalEpisodeId: 'episode-2' },
    patch: { 'beds.H2C2.vitalSigns': { systolic: 120 } },
  },
];

const dependencies = () => ({
  applyPatch: vi.fn().mockResolvedValue(undefined),
  refreshRecord: vi.fn().mockResolvedValue(record),
  createMutationId: vi.fn(() => 'mutation-fixed'),
});

const preParityResponse = (
  payload: RayenClinicalEnrichmentBatchPayload,
  targetCount: number,
  fieldCount: number
) => ({
  success: true as const,
  authorityStatus: 'ok' as const,
  date: payload.date,
  mode: payload.mode,
  targetCount,
  fieldCount,
  patientWrites: payload.mode === 'enforced' ? 1 : 0,
  historySnapshots: payload.mode === 'enforced' ? 1 : 0,
});

describe('applyClinicalEnrichmentBatch rolling compatibility', () => {
  it('rejects an exact committed response from the retired pre-parity backend', async () => {
    const deps = dependencies();
    const invoke = vi.fn(async (payload: RayenClinicalEnrichmentBatchPayload) =>
      preParityResponse(payload, 2, 3)
    );

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-old-enforced-response',
        operations,
        invoke,
        ...deps,
      })
    ).rejects.toThrow('no confirmó paridad');

    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
  });

  it('rejects a pre-parity response with incomplete counts', async () => {
    const deps = dependencies();
    const invoke = vi.fn(async (payload: RayenClinicalEnrichmentBatchPayload) =>
      preParityResponse(payload, 1, 2)
    );

    await expect(
      applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record,
        runId: 'run-old-enforced-incomplete-response',
        operations,
        invoke,
        ...deps,
      })
    ).rejects.toThrow('no confirmó paridad');
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.refreshRecord).toHaveBeenCalledTimes(1);
  });
});
