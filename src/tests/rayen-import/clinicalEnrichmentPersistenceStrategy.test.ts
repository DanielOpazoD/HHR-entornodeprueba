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
  it('defers the original base and revalidation to the actual batch write turn', async () => {
    const initial = record('initial');
    const refreshed = record('after-queued-manual-write');
    const rebuilt = [{ ...operations[0]!, clinicalFieldCount: 2 }];
    const refreshRecord = vi.fn().mockResolvedValue(refreshed);
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    const rebuildOperations = vi.fn().mockReturnValue(rebuilt);
    const strategy = createClinicalEnrichmentPersistenceStrategy({
      mode: 'enforced',
      record: initial,
      runId: 'sync-enforced',
      refreshRecord,
      applyBatch,
      rebuildOperations,
    });

    expect(strategy.disposition).toBe('deferred');
    await strategy.persist(operations);

    // No read can take a stale snapshot before the shared write coordinator admits this batch.
    expect(refreshRecord).not.toHaveBeenCalled();
    expect(rebuildOperations).not.toHaveBeenCalled();
    const request = applyBatch.mock.calls[0]?.[0];
    expect(request).toMatchObject({ record: initial, operations, refreshRecord });
    expect(request).not.toHaveProperty('refreshCommittedRecord');
    expect(request.rebuildOperations(refreshed)).toBe(rebuilt);
    expect(rebuildOperations).toHaveBeenCalledWith({
      baseRecord: initial,
      currentRecord: refreshed,
      operations,
    });
  });

  it('hands a separate post-commit refresh to the batch when given one', async () => {
    const applyBatch = vi.fn().mockResolvedValue({ patientWrites: 1, historySnapshots: 1 });
    const refreshCommittedRecord = vi.fn();
    const strategy = createClinicalEnrichmentPersistenceStrategy({
      mode: 'enforced',
      record: record('initial'),
      runId: 'sync-enforced',
      refreshRecord: vi.fn(),
      refreshCommittedRecord,
      applyBatch,
    });

    await strategy.persist(operations);

    expect(applyBatch.mock.calls[0]?.[0].refreshCommittedRecord).toBe(refreshCommittedRecord);
  });
});
