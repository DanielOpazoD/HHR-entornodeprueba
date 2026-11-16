// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDailyRecordAggregate } from '@/services/repositories/dailyRecordAggregate';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const buildRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-03-07',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-03-07T08:00:00.000Z',
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: [],
    ...overrides,
  }) as DailyRecord;

describe('dailyRecordAggregate', () => {
  it('exposes canonical staffing facets with legacy-compatible fallbacks', () => {
    const aggregate = createDailyRecordAggregate(
      buildRecord({
        nurses: ['Legacy A', 'Legacy B'],
        nursesDayShift: ['', ''],
        nursesNightShift: ['Noche 1', ''],
      })
    );

    expect(aggregate.staffing.nursesDay).toEqual(['Legacy A', 'Legacy B']);
    expect(aggregate.staffing.nursesNight).toEqual(['Noche 1']);
  });
});
