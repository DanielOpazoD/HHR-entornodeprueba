// @vitest-environment node

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

    // Fifteen search and mapping helpers had their own copy of this pipeline; they now call
    // removeAccents and keep their own order of trim/lowercase. Each removed copy, verbatim:
    const strip = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const removedCopies = {
      lower: (value: string) => strip(value).toLowerCase(),
      lowerTrim: (value: string) => strip(value).toLowerCase().trim(),
      trimLower: (value: string) => strip(value).trim().toLowerCase(),
      lowerFirst: (value: string) => strip(value.toLowerCase()),
      trimLowerFirst: (value: string) => strip(value.trim().toLowerCase()),
    };
    const replacements: Record<keyof typeof removedCopies, (value: string) => string> = {
      lower: value => removeAccents(value).toLowerCase(),
      lowerTrim: value => removeAccents(value).toLowerCase().trim(),
      trimLower: value => removeAccents(value).trim().toLowerCase(),
      lowerFirst: value => removeAccents(value.toLowerCase()),
      trimLowerFirst: value => removeAccents(value.trim().toLowerCase()),
    };
    const samples = [
      '',
      '   ',
      'Pabellón',
      '  TRASLADÓ a Hospital  ',
      'Pingüino ÜBER',
      'Ñandú niño NIÑO',
      'Sonda Nasogástrica',
      'a \u0301',
      '\u0301 inicio',
      'İstanbul ẞ ΟΔΟΣ',
      'e\u0301 é',
    ];
    // Every character of the basic plane, alone and between spaces.
    for (let code = 0; code <= 0xffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCharCode(code);
      samples.push(char, ` ${char} `);
    }

    it.each(Object.keys(removedCopies) as Array<keyof typeof removedCopies>)(
      'matches the removed %s copy on every sample',
      name => {
        const mismatches = samples.filter(
          sample => replacements[name](sample) !== removedCopies[name](sample)
        );
        expect(mismatches).toEqual([]);
      }
    );

    it('folds tildes, diéresis and ñ and leaves case to the caller', () => {
      expect(removeAccents('Ñandú PINGÜINO Pabellón')).toBe('Nandu PINGUINO Pabellon');
      expect(removeAccents('')).toBe('');
    });
  });
});
