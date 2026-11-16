// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isSearchMasterPatientsQueryTooLong,
  normalizeSearchMasterPatientsInput,
} from '@/application/census/searchMasterPatientsContracts';

describe('searchMasterPatientsContracts', () => {
  it('trims search terms and preserves valid limits', () => {
    const result = normalizeSearchMasterPatientsInput({
      searchTerm: '  ines leiva  ',
      limitCount: 25,
    });

    expect(result).toEqual({
      searchTerm: 'ines leiva',
      limitCount: 25,
    });
  });

  it('falls back to default limit when limit is not finite', () => {
    const result = normalizeSearchMasterPatientsInput({
      searchTerm: 'ines',
      limitCount: Number.NaN,
    });

    expect(result.limitCount).toBe(20);
  });

  it('clamps limits into supported bounds', () => {
    expect(
      normalizeSearchMasterPatientsInput({
        searchTerm: 'ines',
        limitCount: -5,
      }).limitCount
    ).toBe(1);

    expect(
      normalizeSearchMasterPatientsInput({
        searchTerm: 'ines',
        limitCount: 9999,
      }).limitCount
    ).toBe(100);
  });

  it('detects when query length exceeds supported maximum', () => {
    expect(isSearchMasterPatientsQueryTooLong('x'.repeat(120))).toBe(false);
    expect(isSearchMasterPatientsQueryTooLong('x'.repeat(121))).toBe(true);
  });
});
