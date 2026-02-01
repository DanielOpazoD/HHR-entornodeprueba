/**
 * useDateNavigation Hook Tests
 * Tests for date navigation state and operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDateNavigation } from '@/hooks/useDateNavigation';

describe('useDateNavigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Initial State', () => {
        it('should initialize with current date', () => {
            const { result } = renderHook(() => useDateNavigation());
            const today = new Date();

            expect(result.current.selectedYear).toBe(today.getFullYear());
            expect(result.current.selectedMonth).toBe(today.getMonth());
            expect(result.current.selectedDay).toBe(today.getDate());
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
    });
});
