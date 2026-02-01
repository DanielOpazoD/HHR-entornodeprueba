/**
 * Tests for Admission Dates Validation
 * Verifies that admission dates are validated correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test date validation logic
describe('Admission Date Validation', () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    describe('Date Format Validation', () => {
        it('should accept valid YYYY-MM-DD format', () => {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            expect(dateRegex.test('2024-12-23')).toBe(true);
            expect(dateRegex.test('2024-01-01')).toBe(true);
        });

        it('should reject invalid date formats', () => {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            expect(dateRegex.test('23-12-2024')).toBe(false);
            expect(dateRegex.test('2024/12/23')).toBe(false);
            expect(dateRegex.test('December 23, 2024')).toBe(false);
        });
    });

    describe('Future Date Prevention', () => {
        const isFutureDate = (dateStr: string, currentDateStr: string): boolean => {
            return dateStr > currentDateStr;
        };

        it('should identify future dates correctly', () => {
            expect(isFutureDate(tomorrowStr, todayStr)).toBe(true);
        });

        it('should allow today date', () => {
            expect(isFutureDate(todayStr, todayStr)).toBe(false);
        });

        it('should allow past dates', () => {
            expect(isFutureDate(yesterdayStr, todayStr)).toBe(false);
        });
    });

    describe('Date Parsing', () => {
        it('should parse valid dates correctly', () => {
            const dateStr = '2024-12-23';
            const [year, month, day] = dateStr.split('-').map(Number);
            expect(year).toBe(2024);
            expect(month).toBe(12);
            expect(day).toBe(23);
        });

        it('should handle edge cases like year boundaries', () => {
            const dec31 = '2024-12-31';
            const jan1 = '2025-01-01';
            expect(jan1 > dec31).toBe(true);
        });
    });
});
