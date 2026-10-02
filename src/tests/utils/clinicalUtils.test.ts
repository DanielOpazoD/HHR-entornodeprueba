// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { splitPatientName, calculateAge, formatDateToCL } from '@/utils/clinicalUtils';

describe('clinicalUtils', () => {
  describe('splitPatientName', () => {
    it('should split standard names correctly', () => {
      const [nombres, apPaterno, apMaterno] = splitPatientName('Marcelo Valdes Avila');
      expect(nombres).toBe('Marcelo');
      expect(apPaterno).toBe('Valdes');
      expect(apMaterno).toBe('Avila');
    });

    it('should handle composite first names', () => {
      const [nombres, apPaterno, apMaterno] = splitPatientName('Juan Carlos De La Fuente Perez');
      expect(nombres).toBe('Juan Carlos De La');
      expect(apPaterno).toBe('Fuente');
      expect(apMaterno).toBe('Perez');
    });

    it('should handle single name', () => {
      const [nombres, apPaterno, apMaterno] = splitPatientName('Marcelo');
      expect(nombres).toBe('Marcelo');
      expect(apPaterno).toBe('');
      expect(apMaterno).toBe('');
    });
  });

  describe('calculateAge', () => {
    it('should handle DD-MM-YYYY', () => {
      const age = calculateAge('15-02-1990');
      expect(age).toMatch(/\d+ años/);
    });

    it('should handle YYYY-MM-DD', () => {
      const age = calculateAge('1990-02-15');
      expect(age).toMatch(/\d+ años/);
    });

    it('should return empty for invalid', () => {
      expect(calculateAge(undefined)).toBe('');
      expect(calculateAge('invalid')).toBe('');
    });
  });

  describe('formatDateToCL', () => {
    it('should convert YYYY-MM-DD to DD-MM-YYYY', () => {
      expect(formatDateToCL('2026-02-15')).toBe('15-02-2026');
    });

    it('should keep DD-MM-YYYY', () => {
      expect(formatDateToCL('15-02-2026')).toBe('15-02-2026');
    });

    it('should return empty for empty input', () => {
      expect(formatDateToCL(undefined)).toBe('');
    });
  });
});
