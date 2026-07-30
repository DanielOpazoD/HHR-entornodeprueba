import { describe, expect, it, vi } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
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

describe('clinical enrichment rolling compatibility', () => {
  it('routes checkpoint-only writes through the deployed callable without clinical history', async () => {
    const operation: ClinicalFillPatchOperation = {
      target: {
        censusDate: record.date,
        bedId: 'H2C1',
        clinicalEpisodeId: 'episode-1',
      },
      patch: {
        'beds.H2C1.clinicalSyncCheckpoint': { version: 2, sources: { vitalSigns: 'cursor-2' } },
      },
      clinicalFieldCount: 0,
      checkpointChanged: true,
    };
    const invoke = vi.fn(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
      success: true,
      authorityStatus: 'ok' as const,
      date: payload.date,
      mode: payload.mode,
      targetCount: 1,
      fieldCount: 1,
      resultParity: 'matched' as const,
      patientWrites: 1,
      historySnapshots: 0,
    }));

    const applyPatch = vi.fn().mockResolvedValue(undefined);
    const result = await applyClinicalEnrichmentBatch({
      mode: 'enforced',
      record,
      runId: 'run-checkpoint-only',
      operations: [operation],
      applyPatch,
      refreshRecord: vi.fn().mockResolvedValue(record),
      invoke,
      createMutationId: () => 'mutation-fixed',
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        patches: [],
        checkpoints: [
          expect.objectContaining({
            bedId: 'H2C1',
            checkpoint: expect.objectContaining({ version: 2 }),
          }),
        ],
      })
    );
    expect(applyPatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ patientWrites: 1, historySnapshots: 0 });
  });
});
