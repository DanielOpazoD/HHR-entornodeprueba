import { describe, expect, it } from 'vitest';
import { prepareClinicalEnrichmentBatchPayload } from '@/features/rayen-import/hooks/clinicalEnrichmentBatchPayload';
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

const prepare = (operations: ClinicalFillPatchOperation[]) =>
  prepareClinicalEnrichmentBatchPayload({
    mode: 'enforced',
    record,
    runId: 'run-payload',
    mutationId: 'mutation-payload',
    operations,
  });

describe('clinicalEnrichmentBatchPayload', () => {
  it('keeps a checkpoint-only update inside the transactional fast path', () => {
    const { payload, evidence } = prepare([
      {
        target: {
          censusDate: record.date,
          bedId: 'H2C1',
          clinicalEpisodeId: 'episode-1',
        },
        patch: {
          'beds.H2C1.clinicalSyncCheckpoint': { version: 1, sources: { vitals: {} } },
        },
        clinicalFieldCount: 0,
        checkpointChanged: true,
      },
    ]);

    expect(payload).toMatchObject({
      fieldContractVersion: 2,
      patches: [],
      checkpoints: [
        {
          bedId: 'H2C1',
          clinicalEpisodeId: 'episode-1',
          checkpoint: { version: 1, sources: { vitals: {} } },
        },
      ],
    });
    expect(evidence).toMatchObject({
      clinicalTargets: 0,
      checkpointTargets: 1,
      checkpointOnlyTargets: 1,
      requestedFields: 1,
    });
  });

  it('separates clinical and checkpoint sections for an RN crib target', () => {
    const { payload, evidence } = prepare([
      {
        target: {
          censusDate: record.date,
          bedId: 'H4C1',
          clinicalEpisodeId: 'episode-rn-1',
          clinicalCrib: true,
        },
        patch: {
          'beds.H4C1.clinicalCrib.vitalSigns': { systolic: 72 },
          'beds.H4C1.clinicalCrib.clinicalSyncCheckpoint': { version: 1, sources: {} },
        },
        clinicalFieldCount: 1,
        checkpointChanged: true,
      },
    ]);

    expect(payload?.patches).toEqual([
      expect.objectContaining({
        bedId: 'H4C1',
        clinicalEpisodeId: 'episode-rn-1',
        clinicalCrib: true,
        fields: { vitalSigns: { systolic: 72 } },
      }),
    ]);
    expect(payload?.checkpoints).toEqual([
      expect.objectContaining({
        bedId: 'H4C1',
        clinicalCrib: true,
        checkpoint: { version: 1, sources: {} },
      }),
    ]);
    expect(evidence).toMatchObject({ clinicalTargets: 1, checkpointOnlyTargets: 0 });
  });

  it('does not create a callable payload when there is no effective operation', () => {
    const { payload, evidence } = prepare([]);

    expect(payload).toBeNull();
    expect(evidence).toMatchObject({
      clinicalTargets: 0,
      checkpointTargets: 0,
      requestedFields: 0,
    });
  });
});
