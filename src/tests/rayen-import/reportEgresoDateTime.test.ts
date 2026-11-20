// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  correctedEgresoFields,
  parseStatisticalEgresoInstant,
  parseStatisticalEgresoStamp,
} from '@/features/rayen-import/mapping/reportEgresoDateTime';

describe('parseStatisticalEgresoStamp', () => {
  it('converts the mainland report clock to Rapa Nui time', () => {
    // Live 2026-07-19 evidence showed the statistical report two hours ahead of the real island
    // discharge time. Named zones preserve that rule across DST instead of hard-coding -2.
    expect(parseStatisticalEgresoStamp('14-07-2026 18:20')).toEqual({
      iso: '2026-07-14',
      calendarIso: '2026-07-14',
      hhmm: '16:20',
      text: '14-07-2026 16:20',
    });
  });

  it('moves the calendar day back when mainland midnight is still the prior island day', () => {
    expect(parseStatisticalEgresoStamp('15-07-2026 00:54')).toEqual({
      iso: '2026-07-14',
      calendarIso: '2026-07-14',
      hhmm: '22:54',
      text: '14-07-2026 22:54',
    });
  });

  it('accepts PDF line breaks, slash separators and trailing seconds', () => {
    expect(parseStatisticalEgresoStamp('9/7/2026\n5:04:00')).toEqual({
      iso: '2026-07-08',
      calendarIso: '2026-07-09',
      hhmm: '03:04',
      text: '09-07-2026 03:04',
    });
  });

  it('assigns a Saturday-morning discharge to Friday before the 09:00 handoff', () => {
    expect(parseStatisticalEgresoStamp('25-07-2026 10:30')).toEqual({
      iso: '2026-07-24',
      calendarIso: '2026-07-25',
      hhmm: '08:30',
      text: '25-07-2026 08:30',
    });
  });

  it('reads cells from 2026-09-23 on the Rapa Nui clock they print', () => {
    // Measured 2026-11-04: 97/97 cells since 09-24 equal the episode time in Rapa Nui.
    expect(parseStatisticalEgresoStamp('02-11-2026 11:55')).toEqual({
      iso: '2026-11-02',
      calendarIso: '2026-11-02',
      hhmm: '11:55',
      text: '02-11-2026 11:55',
    });
  });

  it('keeps a morning discharge after the handoff in its own census day', () => {
    // Read as mainland time, 09:30 became 07:30 and moved the discharge to the previous day.
    expect(parseStatisticalEgresoStamp('04-11-2026 09:30')?.iso).toBe('2026-11-04');
  });

  it('still converts cells up to 2026-09-22 from the mainland clock', () => {
    expect(parseStatisticalEgresoStamp('22-09-2026 14:10')?.hhmm).toBe('12:10');
    expect(parseStatisticalEgresoStamp('24-09-2026 14:10')?.hhmm).toBe('14:10');
  });

  it('returns null for an unparseable or impossible stamp', () => {
    expect(parseStatisticalEgresoStamp('')).toBeNull();
    expect(parseStatisticalEgresoStamp('sin fecha')).toBeNull();
    expect(parseStatisticalEgresoStamp('2026-07-11')).toBeNull();
    expect(parseStatisticalEgresoStamp('31-02-2026 18:20')).toBeNull();
    expect(parseStatisticalEgresoStamp('14-07-2026 25:00')).toBeNull();
  });
});

describe('parseStatisticalEgresoInstant', () => {
  it.each(['2026-11-05T03:30:00Z', '2026-11-05T00:30:00-03:00', '2026-11-05T00:30:00-0300'])(
    'reads %s as the same Rapa Nui instant',
    value => {
      expect(parseStatisticalEgresoInstant(value)).toEqual({
        iso: '2026-11-04',
        calendarIso: '2026-11-04',
        hhmm: '22:30',
        text: '04-11-2026 22:30',
      });
    }
  );

  it('keeps the calendar day of a Saturday 08:30 discharge filed on the Friday census', () => {
    expect(parseStatisticalEgresoInstant('2026-11-07T10:30:00.000-0300')).toEqual({
      iso: '2026-11-06',
      calendarIso: '2026-11-07',
      hhmm: '08:30',
      text: '07-11-2026 08:30',
    });
  });

  it('accepts 29 February only in a leap year', () => {
    expect(parseStatisticalEgresoInstant('2028-02-29T15:00:00Z')).toMatchObject({
      calendarIso: '2028-02-29',
      hhmm: '10:00',
    });
    expect(parseStatisticalEgresoInstant('2027-02-29T15:00:00Z')).toBeNull();
  });

  it('leaves an impossible, unzoned or missing stamp unconfirmed instead of rolling it over', () => {
    expect(parseStatisticalEgresoInstant('2026-02-30T18:00:00Z')).toBeNull();
    expect(parseStatisticalEgresoInstant('2026-11-31T10:00:00-0300')).toBeNull();
    expect(parseStatisticalEgresoInstant('2026-02-30t18:00:00z')).toBeNull();
    expect(parseStatisticalEgresoInstant('2026-11-05T00:30:00')).toBeNull();
    expect(parseStatisticalEgresoInstant('')).toBeNull();
  });

  it('still accepts every instant main accepted: any case, a space and a compact offset', () => {
    const expected = { iso: '2026-11-06', calendarIso: '2026-11-06', hhmm: '15:20' };
    for (const value of [
      '2026-11-06T20:20:00Z',
      '2026-11-06t20:20:00z',
      '2026-11-06 20:20:00+00:00',
      '2026-11-06T17:20:00-0300',
      '2026-11-6 20:20:00+0000',
      '2026-11-06 20:20:00+0000',
      '2026-11-006 20:20:00+0000',
    ])
      expect(parseStatisticalEgresoInstant(value)).toMatchObject(expected);
    // Read as integers, an impossible day is still rejected whatever its width.
    expect(parseStatisticalEgresoInstant('2026-11-031 10:00:00+0000')).toBeNull();
    expect(parseStatisticalEgresoInstant('2026-02-030T18:00:00Z')).toBeNull();
  });
});

describe('correctedEgresoFields', () => {
  it('carries the calendar day only when it belongs to the resolved census day', () => {
    expect(correctedEgresoFields('2026-11-07', '08:30')).toEqual({
      correctedDay: '2026-11-06',
      correctedCalendarDay: '2026-11-07',
      correctedTime: '08:30',
    });
    expect(correctedEgresoFields('2026-02-30', '08:30')).not.toHaveProperty('correctedCalendarDay');
  });
});
