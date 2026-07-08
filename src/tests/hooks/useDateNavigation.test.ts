/**
 * useDateNavigation Hook Tests
 * Tests for date navigation state and operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDateNavigation } from '@/hooks/useDateNavigation';

describe('useDateNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T09:00:00.000Z'));
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('lands on the previous calendar day before the shift rollover (night shift)', () => {
      // Local 07:59 on 2026-02-20, before the 08:00/09:00 day-shift start: the clinical
      // "today" is still 2026-02-19, so the landing day must be the previous calendar day.
      vi.setSystemTime(new Date(2026, 1, 20, 7, 59, 0));

      const { result } = renderHook(() => useDateNavigation());

      expect(result.current.currentDateString).toBe('2026-02-19');
    });

    it('lands on the current calendar day after the shift rollover (day shift)', () => {
      // Local 09:30 on 2026-02-20, after the rollover: clinical "today" is 2026-02-20.
      vi.setSystemTime(new Date(2026, 1, 20, 9, 30, 0));

      const { result } = renderHook(() => useDateNavigation());

      expect(result.current.currentDateString).toBe('2026-02-20');
    });

    it('should initialize from the date query string when present', () => {
      window.history.replaceState({}, '', '/?date=2026-03-14');

      const { result } = renderHook(() => useDateNavigation());

      expect(result.current.selectedYear).toBe(2026);
      expect(result.current.selectedMonth).toBe(2);
      expect(result.current.selectedDay).toBe(14);
    });

    it('should generate correct date string format', () => {
      const { result } = renderHook(() => useDateNavigation());

      // Should be in YYYY-MM-DD format
      expect(result.current.currentDateString).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('setSelectedYear', () => {
    it('should update the year', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2020);
      });

      expect(result.current.selectedYear).toBe(2020);
    });
  });

  describe('setSelectedMonth', () => {
    it('should update the month', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedMonth(5); // June (0-indexed)
      });

      expect(result.current.selectedMonth).toBe(5);
    });
  });

  describe('setSelectedDay', () => {
    it('should update the day', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedDay(15);
      });

      expect(result.current.selectedDay).toBe(15);
    });
  });

  describe('daysInMonth', () => {
    it('should return correct days for January', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2024);
        result.current.setSelectedMonth(0); // January
      });

      expect(result.current.daysInMonth).toBe(31);
    });

    it('should return correct days for February in leap year', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2024); // Leap year
        result.current.setSelectedMonth(1); // February
      });

      expect(result.current.daysInMonth).toBe(29);
    });

    it('should return correct days for February in non-leap year', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2025); // Not a leap year
        result.current.setSelectedMonth(1); // February
      });

      expect(result.current.daysInMonth).toBe(28);
    });
  });

  describe('currentDateString', () => {
    it('should format date with zero-padded month and day', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2024);
        result.current.setSelectedMonth(0); // January
        result.current.setSelectedDay(5);
      });

      expect(result.current.currentDateString).toBe('2024-01-05');
    });

    it('should format date correctly for double-digit month/day', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2024);
        result.current.setSelectedMonth(11); // December
        result.current.setSelectedDay(25);
      });

      expect(result.current.currentDateString).toBe('2024-12-25');
    });

    it('should not force the current date into the URL while navigating days', () => {
      const { result } = renderHook(() => useDateNavigation());

      act(() => {
        result.current.setSelectedYear(2024);
        result.current.setSelectedMonth(11);
        result.current.setSelectedDay(25);
      });

      expect(window.location.search).toBe('');
    });
  });
});
