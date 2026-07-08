import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveCurrentClinicalDay = vi.fn(() => '2026-06-28');
vi.mock('@/utils/clinicalDayUtils', () => ({
  resolveCurrentClinicalDay: () => resolveCurrentClinicalDay(),
}));

import { useDateNavigation } from '@/hooks/useDateNavigation';

describe('useDateNavigation — clinical-day landing', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    resolveCurrentClinicalDay.mockReturnValue('2026-06-28');
  });

  afterEach(() => {
    resolveCurrentClinicalDay.mockReset();
  });

  it('lands on the clinical day by default (not the raw calendar date)', () => {
    const { result } = renderHook(() => useDateNavigation());
    expect(result.current.currentDateString).toBe('2026-06-28');
  });

  it('still honors an explicit ?date= deep-link over the clinical day', () => {
    window.history.replaceState({}, '', '/?date=2026-03-14');
    const { result } = renderHook(() => useDateNavigation());
    expect(result.current.currentDateString).toBe('2026-03-14');
  });
});
