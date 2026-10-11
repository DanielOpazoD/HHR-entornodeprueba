import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  createRecordDateTimestamp,
  ensureDailyRecordDateTimestamp,
  touchDailyRecordLastUpdated,
} from '@/services/repositories/dailyRecordMetadataDomainService';

describe('dailyRecordMetadataDomainService', () => {
  it('creates and assigns date timestamps from canonical dates', () => {
    const record = { date: '2026-02-19' } as DailyRecord;

    ensureDailyRecordDateTimestamp(record);

    expect(createRecordDateTimestamp('2026-02-19')).toBe(Date.parse('2026-02-19T00:00:00Z'));
    expect(record.dateTimestamp).toBe(Date.parse('2026-02-19T00:00:00Z'));
  });

  it.each(['2026-02-19T00:00:00.000Z', '2026-02-19T03:00:00.000Z', '2026-02-19T05:00:00.000Z'])(
    'preserves a valid persisted timestamp %s independent of device midnight',
    iso => {
      const record = {
        date: '2026-02-19',
        dateTimestamp: Date.parse(iso),
      } as DailyRecord;

      ensureDailyRecordDateTimestamp(record);

      expect(record.dateTimestamp).toBe(Date.parse(iso));
    }
  );

  it.each([NaN, Infinity, 9000000000000000, Date.parse('2026-02-18T00:00:00Z')])(
    'repairs invalid or unrelated timestamps %s',
    dateTimestamp => {
      const record = { date: '2026-02-19', dateTimestamp } as DailyRecord;
      ensureDailyRecordDateTimestamp(record);
      expect(record.dateTimestamp).toBe(createRecordDateTimestamp(record.date));
    }
  );

  it('touches lastUpdated with a fresh iso timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T14:15:16.000Z'));
    const record = { lastUpdated: '' } as DailyRecord;

    touchDailyRecordLastUpdated(record);

    expect(record.lastUpdated).toBe('2026-03-02T14:15:16.000Z');
    vi.useRealTimers();
  });
});
