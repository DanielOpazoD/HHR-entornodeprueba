import { describe, expect, it, vi } from 'vitest';
import { createClinicalEnrichmentPersistenceStrategy } from '@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import { persistClinicalBatch } from '@/features/rayen-import/domain/clinicalBatchPersistence';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { createDependencies } from './applyClinicalEnrichmentBatch.fixtures';

const BEDS = ['R1', 'R2', 'R3'] as const;

const record = (heartRates: Record<string, number> = {}, revision = 1): DailyRecord =>
  ({
    date: '2026-11-08',
    lastUpdated: `2026-11-08T10:00:0${revision}.000Z`,
    meta: { revision },
    beds: Object.fromEntries(
      BEDS.map((bedId, index) => [
        bedId,
        {
          bedId,
          patientName: `PACIENTE SINTÉTICO ${index + 1}`,
          rut: '12.345.678-5',
          clinicalEpisodeId: `episode-${index + 1}`,
          specialty: 'Otro',
          vitalSigns: { heartRate: heartRates[bedId] ?? 70 },
        },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
  }) as unknown as DailyRecord;

const operations: ClinicalFillPatchOperation[] = BEDS.map((bedId, index) => ({
  target: { censusDate: '2026-11-08', bedId, clinicalEpisodeId: `episode-${index + 1}` },
  patch: { [`beds.${bedId}.vitalSigns`]: { heartRate: 82 } } as ClinicalFillPatchOperation['patch'],
  clinicalFieldCount: 1,
}));

/** The real strategy, rebuild and payload; only the server read and the call are substituted. */
const persistAgainst = async (
  current: DailyRecord,
  prepare?: (deps: ReturnType<typeof createDependencies>) => void
) => {
  const deps = createDependencies();
  deps.refreshRecord.mockResolvedValue(current);
  prepare?.(deps);
  const strategy = createClinicalEnrichmentPersistenceStrategy({
    mode: 'enforced',
    record: record(),
    runId: 'run-field-conflict',
    refreshRecord: deps.refreshRecord,
    applyBatch: input =>
      applyClinicalEnrichmentBatch({
        ...input,
        invoke: deps.invoke,
        createMutationId: deps.createMutationId,
      }),
  });
  const result = await persistClinicalBatch({
    operations,
    strategy,
    applyWithMetrics: operation => operation(),
    recordRetries: vi.fn(),
    recordPersistenceEvidence: vi.fn(),
    wait: vi.fn(async () => undefined),
  });
  const payloads = deps.invoke.mock.calls.map(
    ([payload]) => payload as RayenClinicalEnrichmentBatchPayload
  );
  return { result, payloads };
};

describe('clinical batch when one patient changed concurrently', () => {
  it('writes the other patients and leaves only the changed one pending', async () => {
    // Someone saved a newer heart rate for the second patient after the run read its base.
    const current = record({ R2: 75 }, 2);

    const { result, payloads } = await persistAgainst(current);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.patches.map(patch => patch.bedId).sort()).toEqual(['R1', 'R3']);
    expect(JSON.stringify(payloads[0])).not.toContain('episode-2');
    expect(result.patched).toBe(2);
    expect(result.errors).toEqual([
      expect.objectContaining({
        bedId: 'R2',
        clinicalEpisodeId: 'episode-2',
        source: 'patch',
        reason: 'write_failed',
        cause: 'batch_field_changed',
      }),
    ]);

    const coverage = buildRayenSyncCoverage(3, result.errors, '2026-11-08T18:09:00.000Z', current);
    expect(coverage.issues).toEqual([
      expect.objectContaining({
        bedId: 'R2',
        reason: 'write_failed',
        cause: 'batch_field_changed',
      }),
    ]);
  });

  it('leaves out a patient that changed between the write turn and the transaction', async () => {
    const changed = record({ R3: 75 }, 2);

    const { result, payloads } = await persistAgainst(record(), deps => {
      deps.invoke.mockRejectedValueOnce(
        Object.assign(new Error('revision_mismatch'), { code: 'functions/aborted' })
      );
      deps.refreshRecord.mockResolvedValueOnce(record()).mockResolvedValue(changed);
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[1]!.patches.map(patch => patch.bedId).sort()).toEqual(['R1', 'R2']);
    expect(result.patched).toBe(2);
    expect(result.errors).toEqual([
      expect.objectContaining({ clinicalEpisodeId: 'episode-3', cause: 'batch_field_changed' }),
    ]);
  });

  it('writes nothing and keeps every patient pending when all of them changed', async () => {
    const { result, payloads } = await persistAgainst(record({ R1: 71, R2: 72, R3: 73 }, 2));

    expect(payloads).toEqual([]);
    expect(result.patched).toBe(0);
    expect(result.errors.map(error => [error.clinicalEpisodeId, error.cause])).toEqual([
      ['episode-1', 'batch_field_changed'],
      ['episode-2', 'batch_field_changed'],
      ['episode-3', 'batch_field_changed'],
    ]);
  });
});
