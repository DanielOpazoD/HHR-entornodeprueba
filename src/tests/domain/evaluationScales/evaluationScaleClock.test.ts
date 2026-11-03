import { describe, expect, it } from 'vitest';

import { evaluationScaleStampInRapaNui } from '@/domain/evaluationScales/evaluationScaleClock';

describe('stored Braden and Downton applications, read on the hospital clock', () => {
  // The shapes found in production on 2026-11-03 (392 applications), in both seasons.
  it.each([
    ['history JSON, summer time', '2026-10-01T10:15:00', '2026-10-01T08:15:00'],
    ['history JSON with fractional seconds', '2026-10-01T10:15:00.12', '2026-10-01T08:15:00'],
    ['history JSON, winter time', '2026-07-13T07:30:00.1', '2026-07-13T05:30:00'],
    [
      'a mainland 00:30, still the previous Rapa Nui day',
      '2026-10-02T00:30:00',
      '2026-10-01T22:30:00',
    ],
    ['scale report on the mainland offset', '01-10-2026 10:15:00 -03:00', '2026-10-01T08:15:00'],
    ['scale report on the Rapa Nui offset', '01-10-2026 08:15:00 -05:00', '2026-10-01T08:15:00'],
    ['scale report with a one-digit hour', '01-10-2026 9:05:00 -03:00', '2026-10-01T07:05:00'],
    ['scale report in winter', '10-07-2026 08:00:00 -06:00', '2026-07-10T08:00:00'],
  ])('%s', (_case, stored, expected) => {
    expect(evaluationScaleStampInRapaNui(stored)).toBe(expected);
  });

  it('leaves stamps without a readable clock to the stored day', () => {
    for (const stored of ['', '2026-10-01', '26-07-2026 16:16', 'sin fecha', undefined])
      expect(evaluationScaleStampInRapaNui(stored)).toBeNull();
  });
});
