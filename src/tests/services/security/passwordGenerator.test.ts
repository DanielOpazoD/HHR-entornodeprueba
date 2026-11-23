// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateCensusPassword, getCensusPassword } from '@/utils/passwordGenerator';

describe('passwordGenerator', () => {
  it('should generate a 4-digit numeric PIN', () => {
    const pin = generateCensusPassword('2025-01-01');
    expect(pin).toMatch(/^\d{4}$/);
  });

  it('should be deterministic for the same date', () => {
    const pin1 = generateCensusPassword('2025-01-01');
    const pin2 = generateCensusPassword('2025-01-01');
    expect(pin1).toBe(pin2);
  });

  it('should stay the same within the same month', () => {
    const pin1 = generateCensusPassword('2025-01-01');
    const pin2 = generateCensusPassword('2025-01-31');
    expect(pin1).toBe(pin2);
  });

  it('should change when the month changes', () => {
    const pin1 = generateCensusPassword('2025-01-31');
    const pin2 = generateCensusPassword('2025-02-01');
    expect(pin1).not.toBe(pin2);
  });

  it('should repeat the month as the monthly PIN', () => {
    expect(generateCensusPassword('2025-01-01')).toBe('0101');
    expect(generateCensusPassword('2025-04-18')).toBe('0404');
    expect(generateCensusPassword('2025-12-28')).toBe('1212');
  });

  it('should have getCensusPassword as an alias', () => {
    expect(getCensusPassword).toBe(generateCensusPassword);
  });
});
