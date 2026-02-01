import { describe, it, expect } from 'vitest';
import { formatDateDDMMYYYY, getTodayISO } from '@/utils/dateUtils';

describe('dateFormatter', () => {
    describe('formatDateDDMMYYYY', () => {
        it('should format ISO date to DD-MM-YYYY', () => {
            expect(formatDateDDMMYYYY('2025-01-15')).toBe('15-01-2025');
        });

        it('should handle single-digit days and months', () => {
            expect(formatDateDDMMYYYY('2025-03-05')).toBe('05-03-2025');
        });

        it('should return dash for undefined', () => {
            expect(formatDateDDMMYYYY(undefined)).toBe('-');
        });

        it('should return dash for empty string', () => {
            expect(formatDateDDMMYYYY('')).toBe('-');
        });

        it('should handle December correctly', () => {
            expect(formatDateDDMMYYYY('2025-12-25')).toBe('25-12-2025');
        });

        it('should handle leap year February 29', () => {
            expect(formatDateDDMMYYYY('2024-02-29')).toBe('29-02-2024');
        });

        it('should return original string for invalid format', () => {
            expect(formatDateDDMMYYYY('invalid')).toBe('invalid');
        });
    });

    describe('getTodayISO', () => {
        it('should return date in YYYY-MM-DD format', () => {
            const result = getTodayISO();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should return today date (local timezone)', () => {
            const result = getTodayISO();
            // Use same logic as getTodayISO to get expected value
            const now = new Date();
            const offset = now.getTimezoneOffset() * 60000;
            const expectedToday = (new Date(now.getTime() - offset)).toISOString().split('T')[0];
            expect(result).toBe(expectedToday);
        });
    });
});
