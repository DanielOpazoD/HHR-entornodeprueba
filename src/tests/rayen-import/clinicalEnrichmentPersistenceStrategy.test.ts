import { describe, expect, it, vi } from 'vitest';
import { createClinicalEnrichmentPersistenceStrategy } from '@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';

const record = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-08-02',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
  }) as unknown as DailyRecord;

const operations: ClinicalFillPatchOperation[] = [
  {
    patch: { beds: {} },
    target: {
      censusDate: '2026-08-02',
      bedId: 'R1',
      clinicalEpisodeId: 'episode-1',
    },
    clinicalFieldCount: 1,
    checkpointChanged: true,
  },
];

describe('createClinicalEnrichmentPersistenceStrategy', () => {
  it('keeps off mode on immediate writes without allocating a batch run', async () => {
    const strategy = createClinicalEnrichmentPersistenceStrategy({
      mode: 'off',
      record: record('initial'),
      runId: 'sync-run',
      applyPatch: vi.fn(),
      refreshRecord: vi.fn(),
    });

    expect(strategy.disposition).toBe('immediate');
    await strategy.persist(operations);
  });

  it('observes shadow parity against the record refreshed after immediate writes', async () => {
    const refreshed = record('refreshed');
    const refreshRecord = vi.fn().mockResolvedValue(refreshed);
    const observeBatch = vi.fn().mockResolvedValue({
      mode: 'shadow',
      parity: 'matched',
      clinicalTargets: 1,
      checkpointOnlyTargets: 0,
      checkpointTargets: 1,
      requestedFields: 2,
    });
    const strategy = createClinicalEnrichmentPersistenceStrategy({
      mode: 'shadow',
      record: record('initial'),
      runId: 'sync-shadow',
      applyPatch: vi.fn(),
      refreshRecord,
      observeBatch,
    });

    expect(strategy.disposition).toBe('observe');
    await strategy.persist(operations);

    expect(refreshRecord).toHaveBeenCalledOnce();
    expect(observeBatch).toHaveBeenCalledWith({
      record: refreshed,
      runId: 'sync-shadow',
      operations,
    });
  });

  it('defers enforced writes to one authority batch with the selected run identity', async () => {
    const initial = record('initial');
    const applyPatch = vi.fn().mockResolvedValue(undefined);
    const refreshRecord = vi.fn().mockResolvedValue(record('refreshed'));
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    const strategy = createClinicalEnrichmentPersistenceStrategy({
      mode: 'enforced',
      record: initial,
      runId: 'sync-enforced',
      applyPatch,
      refreshRecord,
      applyBatch,
    });

    expect(strategy.disposition).toBe('deferred');
    await strategy.persist(operations);

    expect(applyBatch).toHaveBeenCalledWith({
      mode: 'enforced',
      record: initial,
      runId: 'sync-enforced',
      operations,
      rebuildOperations: expect.any(Function),
      applyPatch,
      refreshRecord,
    });
  });
});
