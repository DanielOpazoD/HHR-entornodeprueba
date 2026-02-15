import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  buildMoveCopyDateOptions,
  resolveMoveCopyBaseDate,
} from '@/features/census/controllers/moveCopyModalController';

describe('moveCopyModalController', () => {
  it('adds days against a domain base date and preserves month/year boundaries', () => {
    expect(addDaysToIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('builds ayer/hoy/manana options using the provided base date', () => {
    const options = buildMoveCopyDateOptions('2026-02-13');
    expect(options.map(option => option.isoDate)).toEqual([
      '2026-02-12',
      '2026-02-13',
      '2026-02-14',
    ]);
    expect(options.map(option => option.label)).toEqual(['Ayer', 'Hoy', 'Mañana']);
  });

  it('falls back to fallback date when current record date is invalid', () => {
    expect(resolveMoveCopyBaseDate('invalid-date', '2026-02-15')).toBe('2026-02-15');
    expect(resolveMoveCopyBaseDate(undefined, '2026-02-15')).toBe('2026-02-15');
    expect(resolveMoveCopyBaseDate('2026-02-14', '2026-02-15')).toBe('2026-02-14');
  });
});
