import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveCurrentClinicalDay = vi.fn();
vi.mock('@/utils/clinicalDayUtils', () => ({
  resolveCurrentClinicalDay: () => resolveCurrentClinicalDay(),
}));

import { useClinicalToday } from '@/hooks/useClinicalToday';

describe('useClinicalToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resolveCurrentClinicalDay.mockReturnValue('2026-06-28');
  });

  afterEach(() => {
    vi.useRealTimers();
    resolveCurrentClinicalDay.mockReset();
  });

  it('returns the initial clinical day', () => {
    const { result } = renderHook(() => useClinicalToday());
    expect(result.current).toBe('2026-06-28');
  });

  it('advances on the poll interval when the clinical day rolls over', () => {
    const { result } = renderHook(() => useClinicalToday());
    expect(result.current).toBe('2026-06-28');

    resolveCurrentClinicalDay.mockReturnValue('2026-06-29');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).toBe('2026-06-29');
  });

  it('advances when the tab regains visibility (left open overnight)', () => {
    const { result } = renderHook(() => useClinicalToday());

    resolveCurrentClinicalDay.mockReturnValue('2026-06-29');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toBe('2026-06-29');
  });
});
