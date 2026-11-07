import { describe, expect, it, vi } from 'vitest';
import { createClinicalEnrichmentPersistenceStrategy } from '@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import {
  CLINICAL_BATCH_TRANSPORT_RETRY_DELAY_MS,
  persistClinicalBatch,
} from '@/features/rayen-import/domain/clinicalBatchPersistence';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { createDependencies } from './applyClinicalEnrichmentBatch.fixtures';

const record = (heartRate = 70, revision = 1): DailyRecord =>
  ({
    date: '2026-11-06',
    lastUpdated: `2026-11-06T10:00:0${revision}.000Z`,
    meta: { revision },
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'PACIENTE SINTÉTICO',
        rut: '12.345.678-5',
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
    target: { censusDate: '2026-11-06', bedId: 'R1', clinicalEpisodeId: 'episode-1' },
    patch: { 'beds.R1.vitalSigns': { heartRate: 82 } },
    clinicalFieldCount: 1,
  },
];

/** The real strategy, rebase and payload; only the reads, the call and the clock are substituted. */
const setup = () => {
  const deps = createDependencies();
  deps.refreshRecord.mockResolvedValue(record());
  const strategy = createClinicalEnrichmentPersistenceStrategy({
    mode: 'enforced',
    record: record(),
    runId: 'run-transport',
    refreshRecord: deps.refreshRecord,
    applyBatch: input =>
      applyClinicalEnrichmentBatch({
        ...input,
        invoke: deps.invoke,
        createMutationId: deps.createMutationId,
      }),
  });
  const recordRetries = vi.fn();
  const wait = vi.fn(async (_ms: number, _signal?: AbortSignal): Promise<void> => undefined);
  const persist = (signal?: AbortSignal) =>
    persistClinicalBatch({
      operations,
      strategy,
      applyWithMetrics: operation => operation(),
      recordRetries,
      recordPersistenceEvidence: vi.fn(),
      signal,
      wait,
    });
  return { ...deps, persist, recordRetries, wait };
};

describe('clinical batch after a failure that got no answer', () => {
  it('re-reads the census once and saves when the first read of the write turn failed', async () => {
    const deps = setup();
    deps.refreshRecord.mockRejectedValueOnce(
      Object.assign(new Error('Failed to get document from server.'), { code: 'unavailable' })
    );

    const result = await deps.persist();

    expect(result).toEqual(expect.objectContaining({ patched: 1, errors: [] }));
    // The failed read, the read of the second attempt and the refresh after the commit.
    expect(deps.refreshRecord).toHaveBeenCalledTimes(3);
    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(deps.wait).toHaveBeenCalledWith(CLINICAL_BATCH_TRANSPORT_RETRY_DELAY_MS, undefined);
    expect(deps.recordRetries).toHaveBeenCalledWith(1);
  });

  it('repeats a call that failed in the browser before the server answered', async () => {
    const deps = setup();
    deps.invoke.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await deps.persist();

    expect(result.errors).toEqual([]);
    expect(deps.invoke).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a server answer: it is final and keeps its cause', async () => {
    const deps = setup();
    deps.invoke.mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'functions/permission-denied' })
    );

    const result = await deps.persist();

    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(deps.wait).not.toHaveBeenCalled();
    expect(result.errors).toEqual([
      expect.objectContaining({
        source: 'patch',
        reason: 'write_failed',
        cause: 'permission_denied',
      }),
    ]);
  });

  it('does not repeat a batch that is stale against the census', async () => {
    const deps = setup();
    deps.refreshRecord.mockResolvedValue(record(75, 2));

    const result = await deps.persist();

    expect(deps.refreshRecord).toHaveBeenCalledOnce();
    expect(deps.invoke).not.toHaveBeenCalled();
    // The history names the guard that refused it instead of «unexpected».
    expect(result.errors).toEqual([
      expect.objectContaining({ bedId: 'R1', source: 'patch', cause: 'batch_field_changed' }),
    ]);
  });

  it('stops without a second attempt once the run is cancelled', async () => {
    const deps = setup();
    const controller = new AbortController();
    deps.refreshRecord.mockRejectedValue(new TypeError('Failed to fetch'));
    deps.wait.mockImplementation(async () => controller.abort());

    const result = await deps.persist(controller.signal);

    expect(deps.refreshRecord).toHaveBeenCalledOnce();
    expect(result.errors).toEqual([expect.objectContaining({ cause: 'source_unavailable' })]);
  });

  it('keeps the bounded cause of a write that still failed in the history', () => {
    const coverage = buildRayenSyncCoverage(
      1,
      [
        {
          bedId: 'R1',
          clinicalEpisodeId: 'episode-1',
          source: 'patch',
          reason: 'write_failed',
          cause: 'source_unavailable',
          message: 'Failed to fetch',
        },
      ],
      '2026-11-06T20:30:54.701Z',
      record()
    );
    expect(coverage.issues).toEqual([
      expect.objectContaining({ reason: 'write_failed', cause: 'source_unavailable' }),
    ]);
    expect(JSON.stringify(coverage)).not.toContain('Failed to fetch');
  });
});
