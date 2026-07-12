import { describe, expect, it } from 'vitest';
import { continentalReportToRapaNui } from '@/features/rayen-import/mapping/reportEgresoDateTime';

describe('continentalReportToRapaNui', () => {
  it('subtracts the 2h continental→Rapa Nui gap (Haggen: 22:54 continental = 20:54 island)', () => {
    // The MINSAL admission form (filled locally) shows Haggen's egreso at 20:54 on 11-07; the report
    // prints 22:54 (continental −04). Corrected it must read the island hour, same day.
    expect(continentalReportToRapaNui('11-07-2026 22:54')).toEqual({
      iso: '2026-07-11',
      hhmm: '20:54',
      text: '11-07-2026 20:54',
    });
  });

  it('rolls back to the previous ISLAND day when the continental stamp is just after midnight', () => {
    // 00:54 continental on 07-12 is 22:54 the previous day in Rapa Nui — the day, not just the hour.
    expect(continentalReportToRapaNui('12-07-2026 00:54')).toEqual({
      iso: '2026-07-11',
      hhmm: '22:54',
      text: '11-07-2026 22:54',
    });
  });

  it('pads single-digit day/hour and ignores trailing text', () => {
    expect(continentalReportToRapaNui('9-7-2026 5:04:00')).toEqual({
      iso: '2026-07-09',
      hhmm: '03:04',
      text: '09-07-2026 03:04',
    });
  });

  it('returns null for an unparseable stamp', () => {
    expect(continentalReportToRapaNui('')).toBeNull();
    expect(continentalReportToRapaNui('sin fecha')).toBeNull();
    expect(continentalReportToRapaNui('2026-07-11')).toBeNull();
  });
});
