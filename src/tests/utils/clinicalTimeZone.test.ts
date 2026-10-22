// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLINICAL_TIME_ZONE,
  calendarStampInClinicalTimeZone,
  getClinicalCalendarDateISO,
} from '@/utils/clinicalTimeZone';
import {
  addClinicalDays,
  clinicalDayStartEpochMs,
  formatClinicalClock,
  formatClinicalDayMonthYear,
} from '@/utils/clinicalTimeFormat';
import { getTodayISO, isFutureDate } from '@/utils/dateCoreUtils';
import { getLocalDateInputValue } from '@/utils/localDate';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayAdmissionUtils';

// Santiago 00:30 on Sept 10 is still Sept 9 22:30 in Rapa Nui (two-hour gap during DST).
const SANTIAGO_MIDNIGHT_GAP = new Date('2026-09-10T03:30:00.000Z');
// Santiago 09:33 on Sept 10 (the reported incident) is 07:33 in Rapa Nui.
const REPORTED_INCIDENT = new Date('2026-09-10T12:33:35.000Z');

describe('clinical time zone', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins the hospital wall clock to Rapa Nui', () => {
    expect(CLINICAL_TIME_ZONE).toBe('Pacific/Easter');
    expect(calendarStampInClinicalTimeZone(REPORTED_INCIDENT)).toEqual({
      iso: '2026-09-10',
      hhmm: '07:33',
    });
  });

  it('keeps the calendar day on Sept 9 while mainland clocks already show Sept 10', () => {
    expect(getClinicalCalendarDateISO(SANTIAGO_MIDNIGHT_GAP)).toBe('2026-09-09');
    expect(getTodayISO(SANTIAGO_MIDNIGHT_GAP)).toBe('2026-09-09');
    expect(getLocalDateInputValue(SANTIAGO_MIDNIGHT_GAP)).toBe('2026-09-09');
  });

  it('shares one clock between the calendar date and the clinical day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SANTIAGO_MIDNIGHT_GAP);

    expect(getTodayISO()).toBe('2026-09-09');
    expect(resolveCurrentClinicalDay()).toBe('2026-09-09');
    expect(isFutureDate('2026-09-10')).toBe(true);
    expect(isFutureDate('2026-09-09')).toBe(false);
  });

  it('advances the calendar date exactly at Rapa Nui midnight', () => {
    expect(getClinicalCalendarDateISO(new Date('2026-09-10T04:59:59.000Z'))).toBe('2026-09-09');
    expect(getClinicalCalendarDateISO(new Date('2026-09-10T05:00:00.000Z'))).toBe('2026-09-10');
  });

  it('is independent of the process time zone', () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Santiago', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        expect(getClinicalCalendarDateISO(SANTIAGO_MIDNIGHT_GAP), zone).toBe('2026-09-09');
        expect(getTodayISO(SANTIAGO_MIDNIGHT_GAP), zone).toBe('2026-09-09');
      }
    } finally {
      process.env.TZ = previous;
    }
  });

  it('finds the instant a hospital day starts across the DST change', () => {
    // UTC-6 until Saturday Sept 5 at 22:00 in Rapa Nui, UTC-5 afterwards.
    expect(new Date(clinicalDayStartEpochMs('2026-07-03')).toISOString()).toBe(
      '2026-07-03T06:00:00.000Z'
    );
    expect(new Date(clinicalDayStartEpochMs('2026-09-05')).toISOString()).toBe(
      '2026-09-05T06:00:00.000Z'
    );
    expect(new Date(clinicalDayStartEpochMs('2026-09-06')).toISOString()).toBe(
      '2026-09-06T05:00:00.000Z'
    );
    expect(getClinicalCalendarDateISO(new Date(clinicalDayStartEpochMs('2026-10-22')))).toBe(
      '2026-10-22'
    );
  });

  it('formats dates as day-month-year and clocks on the hospital wall clock', () => {
    expect(addClinicalDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addClinicalDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(formatClinicalDayMonthYear('2026-10-22')).toBe('22-10-2026');
    expect(formatClinicalDayMonthYear(SANTIAGO_MIDNIGHT_GAP.getTime())).toBe('09-09-2026');
    expect(formatClinicalClock(REPORTED_INCIDENT.getTime())).toBe('07:33');
    expect(formatClinicalClock(REPORTED_INCIDENT.getTime(), true)).toBe('07:33:35');
  });
});
