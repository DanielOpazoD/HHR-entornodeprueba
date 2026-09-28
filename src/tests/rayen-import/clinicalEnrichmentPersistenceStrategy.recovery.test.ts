import { describe, expect, it, vi } from 'vitest';
import { createClinicalEnrichmentPersistenceStrategy } from '@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import { persistClinicalBatch } from '@/features/rayen-import/domain/clinicalBatchPersistence';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { createDependencies } from './applyClinicalEnrichmentBatch.fixtures';

const record = (bedId = 'R1', heartRate = 70, revision = 1): DailyRecord =>
  ({
    date: '2026-07-28',
    lastUpdated: `2026-07-28T10:00:0${revision}.000Z`,
    meta: { revision },
    beds: {
      [bedId]: {
        bedId,
        clinicalEpisodeId: 'episode-1',
        specialty: 'Otro',
        vitalSigns: { heartRate },
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
  }) as unknown as DailyRecord;

const operations: ClinicalFillPatchOperation[] = [
  {
    target: { censusDate: '2026-07-28', bedId: 'R1', clinicalEpisodeId: 'episode-1' },
    patch: { 'beds.R1.vitalSigns': { heartRate: 82 } },
    clinicalFieldCount: 1,
  },
];

// Exercise the actual rebase, retry, payload and outcome mapping; only the I/O is substituted.
const setup = (current: DailyRecord) => {
  const deps = createDependencies();
  deps.refreshRecord.mockResolvedValue(current);
  const strategy = createClinicalEnrichmentPersistenceStrategy({
    mode: 'enforced',
    record: record(),
    runId: 'run-recovery',
    applyPatch: deps.applyPatch,
    refreshRecord: deps.refreshRecord,
    applyBatch: input =>
      applyClinicalEnrichmentBatch({
        ...input,
        invoke: deps.invoke,
        createMutationId: deps.createMutationId,
      }),
  });
  const persist = () =>
    persistClinicalBatch({
      operations,
      strategy,
      applyWithMetrics: operation => operation(),
      recordRetries: vi.fn(),
      recordPersistenceEvidence: vi.fn(),
    });
  return { ...deps, persist };
};

describe('clinical persistence recovery composition', () => {
  it.each(['changed field', 'removed episode'] as const)(
    'leaves clinical data pending without sending a known stale batch: %s',
    async scenario => {
      const current = record('R1', 75, 2);
      if (scenario === 'removed episode') current.beds = {};
      const deps = setup(current);
      const before = structuredClone(current);

      const result = await deps.persist();

      expect(result.patched).toBe(0);
      expect(result.errors).toEqual([expect.objectContaining({ bedId: 'R1', source: 'patch' })]);
      expect(deps.invoke).not.toHaveBeenCalled();
      expect(deps.applyPatch).not.toHaveBeenCalled();
      expect(deps.refreshRecord).toHaveBeenCalledOnce();
      expect(current).toEqual(before);
    }
  );

  it('follows the unchanged episode to its new bed without sending manual specialty', async () => {
    const current = record('R2', 70, 2);
    const deps = setup(current);
    const before = structuredClone(current);

    expect(await deps.persist()).toMatchObject({ patched: 1, errors: [] });
    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(deps.invoke.mock.calls[0]?.[0]).toMatchObject({
      baseRevision: 2,
      patches: [
        { bedId: 'R2', clinicalEpisodeId: 'episode-1', fields: { vitalSigns: { heartRate: 82 } } },
      ],
    });
    expect(deps.invoke.mock.calls[0]?.[0].patches[0]?.fields).not.toHaveProperty('specialty');
    expect(current).toEqual(before);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('skips the callable when another writer already committed the desired value', async () => {
    const deps = setup(record('R1', 82, 2));
    expect(await deps.persist()).toMatchObject({ errors: [] });
    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('still recovers a version conflict after an unavailable preflight read', async () => {
    const deps = setup(record('R2', 70, 2));
    deps.refreshRecord.mockRejectedValueOnce(new Error('offline'));
    deps.invoke.mockRejectedValueOnce({ code: 'functions/aborted', message: 'revision_mismatch' });

    expect(await deps.persist()).toMatchObject({ patched: 1, errors: [] });
    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[0]?.[0]).toMatchObject({ baseRevision: 1 });
    expect(deps.invoke.mock.calls[1]?.[0]).toMatchObject({
      baseRevision: 2,
      mutationId: deps.invoke.mock.calls[0]?.[0].mutationId,
      patches: [expect.objectContaining({ bedId: 'R2' })],
    });
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('retries a lost response with the identical payload and mutation identity', async () => {
    const deps = setup(record());
    deps.invoke.mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response lost' });

    expect(await deps.persist()).toMatchObject({ patched: 1, errors: [] });
    expect(deps.invoke).toHaveBeenCalledTimes(2);
    expect(deps.invoke.mock.calls[1]?.[0]).toEqual(deps.invoke.mock.calls[0]?.[0]);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});
