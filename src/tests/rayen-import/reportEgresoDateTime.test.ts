import { describe, expect, it } from 'vitest';
import { parseStatisticalEgresoStamp } from '@/features/rayen-import/mapping/reportEgresoDateTime';

describe('parseStatisticalEgresoStamp', () => {
  it('preserves the official statistical egreso hour already printed in Rapa Nui time', () => {
    // Live evidence: the individual statistical report prints EGRESO 18:20 and the underlying
    // administrative-discharge event represents the same 18:20 island wall-clock instant.
    expect(parseStatisticalEgresoStamp('14-07-2026 18:20')).toEqual({
      iso: '2026-07-14',
      hhmm: '18:20',
      text: '14-07-2026 18:20',
    });
  });

  it('does not pull a genuine D+1 timestamp back into D', () => {
    expect(parseStatisticalEgresoStamp('15-07-2026 00:54')).toEqual({
      iso: '2026-07-15',
      hhmm: '00:54',
      text: '15-07-2026 00:54',
    });
  });

  it('accepts PDF line breaks, slash separators and trailing seconds', () => {
    expect(parseStatisticalEgresoStamp('9/7/2026\n5:04:00')).toEqual({
      iso: '2026-07-09',
      hhmm: '05:04',
      text: '09-07-2026 05:04',
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
