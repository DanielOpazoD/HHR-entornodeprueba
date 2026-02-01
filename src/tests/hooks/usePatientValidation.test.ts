import { describe, it, expect, vi } from 'vitest';
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

        it('should return trimmed invalid RUT as-is but valid', () => {
            const { result } = renderHook(() => usePatientValidation());
            const validation = result.current.validateRut('  abcd  ');
            expect(validation.valid).toBe(true);
            expect(validation.value).toBe('abcd');
        });
    });

    describe('validateAdmissionDate', () => {
        it('should reject a future date', () => {
            const { result } = renderHook(() => usePatientValidation());
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            const dateStr = futureDate.toISOString().split('T')[0];

            const validation = result.current.validateAdmissionDate(dateStr);
            expect(validation.valid).toBe(false);
            expect(validation.error).toBe('La fecha de ingreso no puede ser futura');
        });

        it('should accept today or a past date', () => {
            const { result } = renderHook(() => usePatientValidation());
            // Use local date YYYY-MM-DD instead of UTC toISOString()
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;

            const validation = result.current.validateAdmissionDate(todayStr);
            expect(validation.valid).toBe(true);

            const pastValidation = result.current.validateAdmissionDate('2000-01-01');
            expect(pastValidation.valid).toBe(true);
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
