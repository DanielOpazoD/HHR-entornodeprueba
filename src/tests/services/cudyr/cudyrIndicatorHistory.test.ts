import { describe, expect, it } from 'vitest';
import {
  cudyrIndicatorAnnual,
  cudyrIndicatorMonths,
  type CudyrIndicatorRead,
} from '@/services/cudyr/cudyrIndicatorHistory';
const read = (
  categorized: number,
  eligible: number,
  patch: Partial<CudyrIndicatorRead> = {}
): CudyrIndicatorRead => ({
  summary: {
    percentage: Math.round((100 * categorized) / eligible),
    categorized,
    eligible,
    through: '2026-09-30',
    quality: 'Oficial',
  },
  busy: false,
  error: '',
  ...patch,
});
describe('Compact CUDYR history', () => {
  it('starts in August 2026 and uses the Rapa Nui month, excluding future months', () => {
    expect(cudyrIndicatorMonths(new Date('2026-10-01T02:00:00Z'))).toEqual(['2026-08', '2026-09']);
    expect(cudyrIndicatorMonths(new Date('2026-10-10T20:00:00Z'))).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(cudyrIndicatorMonths(new Date('2026-07-31T20:00:00Z'))).toEqual([]);
  });
  it('weights by patient-days and stops at the consulted month', () => {
    const reads = { '2026-09': read(9, 10), '2026-10': read(50, 100), '2026-11': read(0, 100) };
    expect(cudyrIndicatorAnnual(Object.keys(reads), '2026-10', reads)).toMatchObject({
      percentage: 54,
      categorized: 59,
      eligible: 110,
      missing: false,
      provisional: false,
    });
    expect(cudyrIndicatorAnnual(Object.keys(reads), '2026-09', reads).percentage).toBe(90);
  });
  it('never presents a missing month as zero or a complete annual figure', () => {
    expect(
      cudyrIndicatorAnnual(['2026-09', '2026-10'], '2026-10', { '2026-10': read(50, 100) })
    ).toMatchObject({ percentage: null, missing: true, busy: true });
    expect(
      cudyrIndicatorAnnual(['2026-09', '2026-10'], '2026-10', {
        '2026-09': read(9, 10, { error: 'Sin conexión' }),
        '2026-10': read(50, 100),
      })
    ).toMatchObject({ percentage: 54, error: true });
  });
  it('resets at January and handles no eligible patients', () => {
    const reads = { '2026-12': read(90, 100), '2027-01': read(1, 2) };
    expect(cudyrIndicatorAnnual(Object.keys(reads), '2027-01', reads)).toMatchObject({
      percentage: 50,
      from: '2027-01',
    });
    expect(
      cudyrIndicatorAnnual(['2027-01'], '2027-01', { '2027-01': read(0, 0) }).percentage
    ).toBeNull();
    expect(cudyrIndicatorAnnual([], '2027-01', {}).missing).toBe(false);
  });
});
