import { describe, it, expect } from 'vitest';
import { capitalizeWords, removeAccents } from '@/utils/stringUtils';

describe('stringUtils', () => {
  describe('capitalizeWords', () => {
    it('should capitalize first letter of each word', () => {
      expect(capitalizeWords('juan perez')).toBe('Juan Perez');
      expect(capitalizeWords('JUAN PEREZ')).toBe('Juan Perez');
      expect(capitalizeWords('jUaN pErEz')).toBe('Juan Perez');
    });

    it('should return empty string for empty input', () => {
      expect(capitalizeWords('')).toBe('');
    });
  });

  describe('removeAccents', () => {
    it('should remove diacritics', () => {
      expect(removeAccents('áéíóúñ')).toBe('aeioun');
      expect(removeAccents('ÁÉÍÓÚÑ')).toBe('AEIOUN');
    });
  });
});
