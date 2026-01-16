import { describe, it, expect } from 'vitest';
import { cleanRut, formatRut, calculateRutVerifier, isValidRut, isPassportFormat } from '@/utils/rutUtils';

describe('rutUtils', () => {
    describe('cleanRut', () => {
        it('should remove dots and dashes', () => {
            expect(cleanRut('12.345.678-9')).toBe('123456789');
            expect(cleanRut('12.345.678-K')).toBe('12345678K');
            expect(cleanRut('12345678k')).toBe('12345678K');
        });
    });

    describe('formatRut', () => {
        it('should format clean RUT string', () => {
            expect(formatRut('123456789')).toBe('12.345.678-9');
            expect(formatRut('12345678K')).toBe('12.345.678-K');
        });

        it('should return original if too short', () => {
            expect(formatRut('1')).toBe('1');
        });
    });

    describe('calculateRutVerifier', () => {
        it('should calculate correct verifier digits', () => {
            expect(calculateRutVerifier('12345678')).toBe('5');
            expect(calculateRutVerifier('30686957')).toBe('4');
            expect(calculateRutVerifier('11111111')).toBe('1');
            expect(calculateRutVerifier('11111112')).toBe('K');
            // 11.111.114 -> 4*2 + 1*3 + 1*4 + 1*5 + 1*6 + 1*7 + 1*2 + 1*3 = 8+3+4+5+6+7+2+3 = 38. 38%11=5. 11-5=6.
            // 11.111.118 -> 8*2+3+4+5+6+7+2+3 = 16+30 = 46. 46%11=2. 11-2=9.
            // 11.111.119 -> 9*2+30 = 48. 48%11=4. 11-4=7.
            // Let's use a known 0: 16.148.514-0? No, that was 4.
            // Sum % 11 = 0 -> Remainder 11 -> '0'
            // To get sum % 11 = 0, we need sum to be 44 or 55.
            // 11.111.111 sum was 32. 32 + (x-1)*2 = multiple of 11.
            // 32 + (7-1)*2 = 32 + 12 = 44.
            // So 11.111.117 should have sum 44. 44%11=0. 11-0=11 -> '0'.
            expect(calculateRutVerifier('11111117')).toBe('0');
        });
    });

    describe('isValidRut', () => {
        it('should return true for valid RUTs', () => {
            expect(isValidRut('30.686.957-4')).toBe(true);
            expect(isValidRut('12.345.678-5')).toBe(true);
        });

        it('should return false for invalid RUTs', () => {
            expect(isValidRut('30.686.957-5')).toBe(false);
            expect(isValidRut('invalid')).toBe(false);
            expect(isValidRut('1')).toBe(false);
            expect(isValidRut('')).toBe(false);
        });

        it('should return false if body is not numeric', () => {
            expect(isValidRut('abc-1')).toBe(false);
        });
    });

    describe('isPassportFormat', () => {
        it('should return true for passport formats', () => {
            expect(isPassportFormat('A1234567')).toBe(true);
            expect(isPassportFormat('123 ABC 456')).toBe(true);
        });

        it('should return false for RUT formats', () => {
            expect(isPassportFormat('12.345.678-9')).toBe(false);
            expect(isPassportFormat('')).toBe(false);
        });
    });
});
