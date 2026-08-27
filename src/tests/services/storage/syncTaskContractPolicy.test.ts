import { describe, expect, it } from 'vitest';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const recordWithRevision = (revision: unknown): DailyRecord =>
  ({
    date: '2026-08-26',
    lastUpdated: '2026-08-26T22:30:00.000Z',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    meta: { revision },
  }) as unknown as DailyRecord;

describe('syncTaskContractPolicy', () => {
  it('includes a numeric daily-record base revision', () => {
    expect(buildDailyRecordSyncContract(recordWithRevision(6))).toMatchObject({
      baseRevision: 6,
    });
  });

  it.each([null, undefined, ''])('omits an absent base revision represented by %p', revision => {
    expect(buildDailyRecordSyncContract(recordWithRevision(revision))).not.toHaveProperty(
      'baseRevision'
    );
  });

  it.each([null, undefined, ''])(
    'removes an explicit absent base revision represented by %p',
    revision => {
      expect(
        buildDailyRecordSyncContract(recordWithRevision(null), {
          baseRevision: revision as never,
        })
      ).not.toHaveProperty('baseRevision');
    }
  );
});
