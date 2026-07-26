import { describe, expect, it } from 'vitest';
import { parseStatisticalEgresoStamp } from '@/features/rayen-import/mapping/reportEgresoDateTime';

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

  it('returns null for an unparseable or impossible stamp', () => {
    expect(parseStatisticalEgresoStamp('')).toBeNull();
    expect(parseStatisticalEgresoStamp('sin fecha')).toBeNull();
    expect(parseStatisticalEgresoStamp('2026-07-11')).toBeNull();
    expect(parseStatisticalEgresoStamp('31-02-2026 18:20')).toBeNull();
    expect(parseStatisticalEgresoStamp('14-07-2026 25:00')).toBeNull();
  });
});
