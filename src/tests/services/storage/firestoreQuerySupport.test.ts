// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildFirestoreMonthDateRange,
  mapFirestoreRecords,
} from '@/services/storage/firestore/firestoreQuerySupport';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('firestoreQuerySupport', () => {
  it('builds month date range for zero-based month indexes', () => {
    expect(buildFirestoreMonthDateRange(2024, 11)).toEqual({
      startDate: '2024-12-01',
      endDate: '2024-12-31',
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
