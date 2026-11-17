// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  classifyCensusSyncTargetDay,
  isSupportedCensusSyncDay,
  resolveCensusSyncTarget,
} from '@/features/rayen-import/domain/historicalCensusSync';

const kindOf = (day: string, now: Date) => resolveCensusSyncTarget(day, now).kind;
const lookbackOf = (day: string, now: Date) => resolveCensusSyncTarget(day, now).lookbackDays;

describe('historical census synchronization', () => {
  it('uses the Rapa Nui calendar day to distinguish a historical census', () => {
    const now = new Date('2026-07-16T18:00:00.000Z');
    expect(kindOf('2026-07-15', now)).toBe('historical');
    expect(kindOf('2026-07-16', now)).toBe('current');
  });

  it('keeps the previous calendar date current until the nursing handoff', () => {
    // Saturday 08:30 in Rapa Nui: Friday night is still the active census (09:00 handoff).
    const beforeWeekendHandoff = new Date('2026-07-25T14:30:00.000Z');
    expect(kindOf('2026-07-24', beforeWeekendHandoff)).toBe('current');
    expect(lookbackOf('2026-07-23', beforeWeekendHandoff)).toBe(1);
    expect(kindOf('2026-07-25', beforeWeekendHandoff)).toBe('current');

    const afterWeekendHandoff = new Date('2026-07-25T15:01:00.000Z');
    expect(kindOf('2026-07-25', afterWeekendHandoff)).toBe('current');
    expect(lookbackOf('2026-07-24', afterWeekendHandoff)).toBe(1);
  });

  it('also permits a manually created calendar-day census before the weekday handoff', () => {
    // Tuesday 07:30 in Rapa Nui: 14-09 remains the clinical day, while a manually copied
    // 15-09 census is also a valid explicit synchronization target.
    const beforeWeekdayHandoff = new Date('2026-09-15T12:30:00.000Z');

    expect(resolveCensusSyncTarget('2026-09-14', beforeWeekdayHandoff)).toMatchObject({
      kind: 'current',
      clinicalDay: '2026-09-14',
      lookbackDays: 0,
    });
    expect(resolveCensusSyncTarget('2026-09-15', beforeWeekdayHandoff)).toMatchObject({
      kind: 'current',
      calendarDay: '2026-09-15',
      clinicalDay: '2026-09-14',
      lookbackDays: 0,
    });
    expect(isSupportedCensusSyncDay('2026-09-15', beforeWeekdayHandoff)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-09-16', beforeWeekdayHandoff)).toBe(false);
  });

  it.each([
    ['weekday', '2026-09-15T12:59:00.000Z', '2026-09-15T13:00:00.000Z'],
    ['weekend', '2026-07-25T14:59:00.000Z', '2026-07-25T15:00:00.000Z'],
  ])(
    'changes the previous calendar date from current to historical exactly at the %s handoff',
    (_schedule, beforeIso, atIso) => {
      const before = new Date(beforeIso);
      const atHandoff = new Date(atIso);
      const previousDay = resolveCensusSyncTarget(
        resolveCensusSyncTarget('', before).clinicalDay,
        before
      );

      expect(previousDay).toMatchObject({ kind: 'current', lookbackDays: 0 });
      expect(resolveCensusSyncTarget(previousDay.clinicalDay, atHandoff)).toMatchObject({
        kind: 'historical',
        lookbackDays: 1,
      });
      expect(resolveCensusSyncTarget(previousDay.calendarDay, atHandoff)).toMatchObject({
        kind: 'current',
        lookbackDays: 0,
      });
    }
  );

  it('supports current and past days while rejecting future and malformed dates', () => {
    const now = new Date('2026-07-16T18:00:00.000Z');
    expect(isSupportedCensusSyncDay('2026-07-16', now)).toBe(true);
    expect(lookbackOf('2026-07-15', now)).toBe(1);
    expect(isSupportedCensusSyncDay('2026-07-15', now)).toBe(true);
    expect(kindOf('2026-07-09', now)).toBe('historical');
    expect(isSupportedCensusSyncDay('2026-07-09', now)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-07-08', now)).toBe(true);
    expect(isSupportedCensusSyncDay('2026-07-17', now)).toBe(false);
    expect(isSupportedCensusSyncDay('2026-02-31', now)).toBe(false);
    expect(classifyCensusSyncTargetDay('2026-07-09', now)).toBe('historical');
    expect(resolveCensusSyncTarget('2026-07-09', now)).toMatchObject({
      clinicalDay: '2026-07-16',
      kind: 'historical',
      lookbackDays: 7,
    });
  });
});
