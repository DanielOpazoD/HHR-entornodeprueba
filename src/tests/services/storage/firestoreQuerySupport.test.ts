// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildFirestoreMonthDateRange,
  mapFirestoreRecords,
  toFirestoreRecordMap,
} from '@/services/storage/firestore/firestoreQuerySupport';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('firestoreQuerySupport', () => {
  it('builds month date range for zero-based month indexes', () => {
    expect(buildFirestoreMonthDateRange(2024, 11)).toEqual({
      startDate: '2024-12-01',
      endDate: '2024-12-31',
    });
  });

  it('creates a record map keyed by record date', () => {
    const records = [{ date: '2024-12-01' }, { date: '2024-12-02' }] as DailyRecord[];

    expect(toFirestoreRecordMap(records)).toEqual({
      '2024-12-01': records[0],
      '2024-12-02': records[1],
    });
  });

  it('maps firestore docs from docs array or snapshot-like forEach', () => {
    const mapper = (data: { date: string }, id: string) =>
      ({ date: `${data.date}-${id}` }) as DailyRecord;
    const docs = [
      { id: 'one', data: () => ({ date: '2024-12-01' }) },
      { id: 'two', data: () => ({ date: '2024-12-02' }) },
    ];

    expect(mapFirestoreRecords(docs, mapper)).toEqual([
      { date: '2024-12-01-one' },
      { date: '2024-12-02-two' },
    ]);

    expect(
      mapFirestoreRecords(
        {
          forEach: (callback: (doc: { id: string; data: () => { date: string } }) => void) => {
            docs.forEach(callback);
          },
        },
        mapper
      )
    ).toEqual([{ date: '2024-12-01-one' }, { date: '2024-12-02-two' }]);
  });
});
