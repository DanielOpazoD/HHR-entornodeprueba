import { describe, expect, it } from 'vitest';
import { buildImportedCudyr, CUDYR_IMPORT_SOURCE } from '@/domain/evaluationScales/importedCudyr';

describe('buildImportedCudyr', () => {
  it('imports the composite category when categorized on the census day (Rapa Nui)', () => {
    // Carina's real data: crdValue D3, crdDateTime 2026-07-10T23:12:04Z → 17:12 Rapa Nui = 2026-07-10.
    const result = buildImportedCudyr(
      { crdValue: 'D3', crdDateTime: '2026-07-10T23:12:04.74+00:00' },
      '2026-07-10'
    );
    expect(result).toEqual({
      category: 'D3',
      recordedDate: '2026-07-10',
      source: CUDYR_IMPORT_SOURCE,
    });
  });

  it('resolves the day in Rapa Nui time, not UTC (just-after-midnight UTC belongs to the prior island day)', () => {
    // 2026-07-11T04:00Z == 2026-07-10 22:00 in Pacific/Easter (-06).
    const result = buildImportedCudyr(
      { crdValue: 'B2', crdDateTime: '2026-07-11T04:00:00+00:00' },
      '2026-07-10'
    );
    expect(result?.recordedDate).toBe('2026-07-10');
  });

  it('is a DAILY assessment: a 10-jul categorization must NOT carry over to the 11-jul census', () => {
    expect(
      buildImportedCudyr(
        { crdValue: 'D3', crdDateTime: '2026-07-10T23:12:04.74+00:00' },
        '2026-07-11'
      )
    ).toBeNull();
  });

  it('returns null when the categorization was made AFTER the census day (late sync of a past census)', () => {
    expect(
      buildImportedCudyr({ crdValue: 'D3', crdDateTime: '2026-07-11T15:00:00+00:00' }, '2026-07-10')
    ).toBeNull();
  });

  it('returns null for "S/C" (sin categorizar) and blanks', () => {
    const day = '2026-07-10';
    const dt = '2026-07-10T18:00:00+00:00';
    expect(buildImportedCudyr({ crdValue: 'S/C', crdDateTime: dt }, day)).toBeNull();
    expect(buildImportedCudyr({ crdValue: 'SC', crdDateTime: dt }, day)).toBeNull();
    expect(buildImportedCudyr({ crdValue: '', crdDateTime: dt }, day)).toBeNull();
  });

  it('returns null when the datetime is unparseable', () => {
    expect(buildImportedCudyr({ crdValue: 'D3', crdDateTime: 'nope' }, '2026-07-10')).toBeNull();
  });
});
