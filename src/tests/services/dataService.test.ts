import { afterEach, describe, it, expect, vi } from 'vitest';
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

    afterEach(() => {
      vi.useRealTimers();
    });

    // `getTodayISO` is the hospital calendar day (Pacific/Easter), not the device's. Test
    // runners are pinned to America/Santiago, two hours ahead: between 00:00 and 02:00 in
    // Santiago the island is still on the previous day, so comparing against a local
    // `new Date()` failed every night for two hours.
    it('returns the Rapa Nui calendar day even when the device already rolled over', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-11T03:30:00Z')); // 00:30 Santiago · 22:30 island
      expect(getTodayISO()).toBe('2026-09-10');
    });

    it('rolls over at the island midnight', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-11T06:00:00Z')); // 03:00 Santiago · 00:00 island
      expect(getTodayISO()).toBe('2026-09-11');
    });
  });
});
