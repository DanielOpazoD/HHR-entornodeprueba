// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildOpenCensusDateHandler,
  resolveCensusDateSelection,
} from '@/components/layout/app-content/appContentCensusDateController';

describe('appContentCensusDateController', () => {
  it('resolves a valid ISO date into census selection fields', () => {
    expect(resolveCensusDateSelection('2026-04-12')).toEqual({
      year: 2026,
      month: 3,
      day: 12,
    });
  });

  it('returns null for malformed ISO-like values', () => {
    expect(resolveCensusDateSelection('2026/04/12')).toBeNull();
    expect(resolveCensusDateSelection('bad-date')).toBeNull();
  });

  it('returns null for impossible calendar dates', () => {
    expect(resolveCensusDateSelection('2026-02-31')).toBeNull();
  });

  it('builds a route callback that normalizes a valid census date selection', () => {
    const setCurrentModule = vi.fn();
    const setCensusViewMode = vi.fn();
    const setSelectedYear = vi.fn();
    const setSelectedMonth = vi.fn();
    const setSelectedDay = vi.fn();

    const openCensusDate = buildOpenCensusDateHandler({
      setCurrentModule,
      setCensusViewMode,
      setSelectedYear,
      setSelectedMonth,
      setSelectedDay,
    });

    openCensusDate('2026-04-12');

    expect(setCurrentModule).toHaveBeenCalledWith('CENSUS');
    expect(setCensusViewMode).toHaveBeenCalledWith('REGISTER');
    expect(setSelectedYear).toHaveBeenCalledWith(2026);
    expect(setSelectedMonth).toHaveBeenCalledWith(3);
    expect(setSelectedDay).toHaveBeenCalledWith(12);
  });

  it('ignores invalid dates when building the census date callback', () => {
    const setCurrentModule = vi.fn();
    const openCensusDate = buildOpenCensusDateHandler({
      setCurrentModule,
      setCensusViewMode: vi.fn(),
      setSelectedYear: vi.fn(),
      setSelectedMonth: vi.fn(),
      setSelectedDay: vi.fn(),
    });

    openCensusDate('bad-date');

    expect(setCurrentModule).not.toHaveBeenCalled();
  });
});
