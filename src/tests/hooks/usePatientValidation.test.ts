import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePatientValidation } from '@/hooks/usePatientValidation';

describe('usePatientValidation', () => {
  describe('formatPatientName', () => {
    it('should capitalize each word and trim whitespace', () => {
      const { result } = renderHook(() => usePatientValidation());
      expect(result.current.formatPatientName('  DANIEL opazo  ')).toBe('Daniel Opazo');
    });

    it('should return original value if empty', () => {
      const { result } = renderHook(() => usePatientValidation());
      expect(result.current.formatPatientName('')).toBe('');
      expect(result.current.formatPatientName('   ')).toBe('   ');
    });
  });

  describe('validateRut', () => {
    it('should format a valid raw RUT', () => {
      const { result } = renderHook(() => usePatientValidation());
      const validation = result.current.validateRut('14636523K');
      expect(validation.valid).toBe(true);
      expect(validation.value).toBe('14.636.523-K');
    });

    it('should detect and preserve passport format', () => {
      const { result } = renderHook(() => usePatientValidation());
      const validation = result.current.validateRut('P123456');
      expect(validation.valid).toBe(true);
      expect(validation.value).toBe('P123456');
    });

    it('never formats a numeric passport as a Chilean RUT even when digits pass mod-11 (ID-01)', () => {
      const { result } = renderHook(() => usePatientValidation());
      expect(result.current.validateRut(' 123456785 ', 'Pasaporte')).toEqual({
        valid: true,
        value: '123456785',
      });
      expect(
        result.current.processFieldValue('rut', '14636523K', { documentType: 'Pasaporte' })
      ).toEqual({
        valid: true,
        value: '14636523K',
      });
    });

    it('should return trimmed invalid RUT as-is but valid', () => {
      const { result } = renderHook(() => usePatientValidation());
      const validation = result.current.validateRut('  abcd  ');
      expect(validation.valid).toBe(true);
      expect(validation.value).toBe('abcd');
    });
  });

  describe('validateAdmissionDate', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should reject a future date', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-09T15:00:00.000Z')); // Sept 9, 10:00 in Rapa Nui
      const { result } = renderHook(() => usePatientValidation());
      const dateStr = '2099-01-01';

      const validation = result.current.validateAdmissionDate(dateStr);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe('La fecha de ingreso no puede ser futura');
    });

    it('should accept today or a past date on the hospital clock', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-09T15:00:00.000Z')); // Sept 9, 10:00 in Rapa Nui
      const { result } = renderHook(() => usePatientValidation());

      const validation = result.current.validateAdmissionDate('2026-09-09');
      expect(validation.valid).toBe(true);

      const pastValidation = result.current.validateAdmissionDate('2000-01-01');
      expect(pastValidation.valid).toBe(true);
    });

    it('follows the Rapa Nui calendar instead of mainland or UTC/European device clocks', () => {
      vi.useFakeTimers();
      // Santiago 00:30 on Sept 10 is still Sept 9 22:30 in Rapa Nui.
      vi.setSystemTime(new Date('2026-09-10T03:30:00.000Z'));
      const { result } = renderHook(() => usePatientValidation());
      const previousTz = process.env.TZ;

      try {
        for (const zone of ['Pacific/Easter', 'America/Santiago', 'UTC', 'Europe/Madrid']) {
          process.env.TZ = zone;
          expect(result.current.validateAdmissionDate('2026-09-10').valid, zone).toBe(false);
          expect(result.current.validateAdmissionDate('2026-09-09').valid, zone).toBe(true);
        }

        // Exact Rapa Nui midnight of Sept 10, while Honolulu is still on Sept 9.
        vi.setSystemTime(new Date('2026-09-10T05:00:00.000Z'));
        process.env.TZ = 'Pacific/Honolulu';
        expect(result.current.validateAdmissionDate('2026-09-10').valid).toBe(true);
      } finally {
        process.env.TZ = previousTz;
      }
    });

    it('does not falsely flag empty or malformed dates as future', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-09T15:00:00.000Z'));
      const { result } = renderHook(() => usePatientValidation());

      expect(result.current.validateAdmissionDate('').valid).toBe(true);
      expect(result.current.validateAdmissionDate('invalid').valid).toBe(true);
    });
  });

  describe('processFieldValue', () => {
    it('should route patientName to formatPatientName', () => {
      const { result } = renderHook(() => usePatientValidation());
      const res = result.current.processFieldValue('patientName', 'juan perez');
      expect(res.value).toBe('Juan Perez');
    });

    it('should route rut to validateRut', () => {
      const { result } = renderHook(() => usePatientValidation());
      const res = result.current.processFieldValue('rut', '14636523k');
      expect(res.value).toBe('14.636.523-K');
    });

    it('should route admissionDate to validateAdmissionDate', () => {
      const { result } = renderHook(() => usePatientValidation());
      const res = result.current.processFieldValue('admissionDate', '2000-01-01');
      expect(res.valid).toBe(true);
    });

    it('should return other fields as-is', () => {
      const { result } = renderHook(() => usePatientValidation());
      const res = result.current.processFieldValue('age', '25');
      expect(res.valid).toBe(true);
      expect(res.value).toBe('25');
    });
  });
});
