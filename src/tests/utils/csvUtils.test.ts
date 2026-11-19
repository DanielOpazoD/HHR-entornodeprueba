import { describe, it, expect } from 'vitest';
import { escapeCsvValue } from '@/utils/csvUtils';

describe('csvUtils', () => {
  describe('escapeCsvValue', () => {
    it('should handle simple values', () => {
      expect(escapeCsvValue('hello')).toBe('hello');
      expect(escapeCsvValue(123)).toBe('123');
      expect(escapeCsvValue(true)).toBe('true');
    });

    it('should handle null and undefined', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
    });

    it('should escape commas', () => {
      expect(escapeCsvValue('hello,world')).toBe('"hello,world"');
    });

    it('should escape quotes', () => {
      expect(escapeCsvValue('hello "world"')).toBe('"hello ""world"""');
    });

    it('should escape newlines', () => {
      expect(escapeCsvValue('hello\nworld')).toBe('"hello\nworld"');
    });
  });
});
