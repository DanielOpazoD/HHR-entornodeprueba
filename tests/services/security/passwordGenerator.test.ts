import { describe, it, expect } from 'vitest';
import { generateCensusPassword, getCensusPassword } from '@/services/security/passwordGenerator';

describe('passwordGenerator', () => {
    it('should generate a 6-digit numeric PIN', () => {
        const pin = generateCensusPassword('2025-01-01');
        expect(pin).toMatch(/^\d{6}$/);
    });

    it('should be deterministic for the same date', () => {
        const pin1 = generateCensusPassword('2025-01-01');
        const pin2 = generateCensusPassword('2025-01-01');
        expect(pin1).toBe(pin2);
    });

    it('should be different for different dates', () => {
        const pin1 = generateCensusPassword('2025-01-01');
        const pin2 = generateCensusPassword('2025-01-02');
        expect(pin1).not.toBe(pin2);
    });

    it('should have getCensusPassword as an alias', () => {
        expect(getCensusPassword).toBe(generateCensusPassword);
    });
});
