// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CHILEAN_HOLIDAYS } from '@/utils/chileanHolidays';
import { clinicalCensusDayInRapaNui } from '@/features/rayen-import/domain/historicalCensusSync';
import '../../../extension/clinical-day-runtime.js';

const runtime = (
  globalThis as typeof globalThis & {
    HhrClinicalDayRuntime: {
      calendarDayAt: (date: Date) => string;
      clinicalDayAt: (date: Date) => string | null;
      historyLookbackDays: (censusDate: string, now?: Date) => number;
      holidays: string[];
    };
  }
).HhrClinicalDayRuntime;

describe('trusted extension clinical-day calendar', () => {
  it('stays in parity with the HHR holiday calendar', () => {
    expect(runtime.holidays).toEqual(CHILEAN_HOLIDAYS);
  });

  it('uses the same business and non-business handoff as HHR', () => {
    const instants = [
      new Date('2026-07-25T14:30:00.000Z'), // Saturday 08:30: before 09:00 handoff.
      new Date('2026-07-25T15:01:00.000Z'),
      new Date('2026-07-16T14:30:00.000Z'), // Holiday 08:30: before 09:00 handoff.
      new Date('2026-07-16T15:01:00.000Z'),
    ];
    for (const instant of instants) {
      expect(runtime.clinicalDayAt(instant)).toBe(clinicalCensusDayInRapaNui(instant));
    }
  });

  it('retains the calendar morning while the prior clinical day is still active', () => {
    const saturdayMorning = new Date('2026-07-25T14:30:00.000Z');
    expect(runtime.calendarDayAt(saturdayMorning)).toBe('2026-07-25');
    expect(runtime.clinicalDayAt(saturdayMorning)).toBe('2026-07-24');
  });

  it('fails closed after the governed holiday horizon', () => {
    expect(runtime.clinicalDayAt(new Date('2029-01-01T14:30:00.000Z'))).toBeNull();
  });

  it('bounds history from today through D-7 and fails safely to the legacy window', () => {
    const now = new Date('2026-07-28T18:00:00.000Z');

    expect(runtime.historyLookbackDays('2026-07-28', now)).toBe(2);
    expect(runtime.historyLookbackDays('2026-07-27', now)).toBe(3);
    expect(runtime.historyLookbackDays('2026-07-21', now)).toBe(9);
    expect(runtime.historyLookbackDays('2026-07-14', now)).toBe(14);
    expect(runtime.historyLookbackDays('fecha-invalida', now)).toBe(14);
    expect(runtime.historyLookbackDays('2026-07-29', now)).toBe(14);
  });
});
