import { describe, expect, it } from 'vitest';

import type { DailyRecord } from '@/types';
import {
  buildMonthIntegrityDates,
  resolveMonthRecordsForDelivery,
} from '@/hooks/controllers/censusEmailSendController';

const createRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    nurses: [],
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

describe('censusEmailSendController', () => {
  it('builds month integrity date sequence', () => {
    expect(
      buildMonthIntegrityDates({
        year: 2026,
        monthZeroBased: 1,
        day: 3,
      })
    ).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });

  it('filters records up to selected day and injects current record if missing', () => {
    const records = resolveMonthRecordsForDelivery({
      monthRecords: [createRecord('2026-02-01'), createRecord('2026-02-02')],
      currentRecord: createRecord('2026-02-03'),
      currentDateString: '2026-02-03',
      selectedYear: 2026,
      selectedMonth: 1,
      selectedDay: 3,
    });

    expect(records.map(record => record.date)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });

  it('throws when no records are available for delivery', () => {
    expect(() =>
      resolveMonthRecordsForDelivery({
        monthRecords: [],
        currentRecord: null,
        currentDateString: '2026-02-03',
        selectedYear: 2026,
        selectedMonth: 1,
        selectedDay: 3,
      })
    ).toThrow('No hay registros del mes para generar el Excel maestro.');
  });
});
