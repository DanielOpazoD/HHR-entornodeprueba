// @vitest-environment node

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
  it('keeps an explicitly unknown version instead of substituting the local edit time', () => {
    expect(
      buildDailyRecordSyncContract(recordWithRevision(undefined), { expectedVersion: '' })
        .expectedVersion
    ).toBe('');
  });
  it('includes a numeric daily-record base revision', () => {
    expect(buildDailyRecordSyncContract(recordWithRevision(6))).toMatchObject({
      baseRevision: 6,
    });
  });

  it.each(
    [
      null,
      undefined,
      '',
      false,
      true,
      [],
      [0],
      {},
      ' ',
      '0x0',
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ].map(value => [value])
  )('omits an absent base revision represented by %p', revision => {
    expect(buildDailyRecordSyncContract(recordWithRevision(revision))).not.toHaveProperty(
      'baseRevision'
    );
  });

  it.each(
    [
      null,
      undefined,
      '',
      false,
      true,
      [],
      [0],
      {},
      ' ',
      '0x0',
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ].map(value => [value])
  )('removes an explicit absent base revision represented by %p', revision => {
    expect(
      buildDailyRecordSyncContract(recordWithRevision(null), {
        baseRevision: revision as never,
      })
    ).not.toHaveProperty('baseRevision');
  });
});
