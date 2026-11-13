// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  cleanRut,
  formatRut,
  calculateRutVerifier,
  isValidRut,
  isPassportFormat,
  isSameRut,
  isSameDocument,
  normalizeRut,
  documentIdentityKey,
} from '@/utils/rutUtils';

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
      expect(isValidRut('123.456-0')).toBe(true);
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

  describe('isValidRut with passports', () => {
    // 12345678-5 is a valid RUT, so these digits pass the check-digit rule once letters are dropped.
    it.each(['P123456785', 'P12.345.678-5', 'AB12345678-5', '12345678-5X', '1234A5678-5'])(
      'never reads the passport %s as a RUT',
      passport => {
        expect(isValidRut(passport)).toBe(false);
      }
    );

    it.each(['12345678-5', '12.345.678-5', ' 12.345.678-5 ', '123456785', '11.111.111-1'])(
      'still accepts the RUT %s',
      rut => {
        expect(isValidRut(rut)).toBe(true);
      }
    );

    it.each(['10.000.013-K', '10000013k', ' 10.000.013-k ', '10.000.013-K.', '(10.000.013-K)'])(
      'still accepts the K check digit in %s',
      rut => {
        expect(isValidRut(rut)).toBe(true);
      }
    );

    it.each(['1234K5678-5', '10.000.013-KK', 'K10.000.013'])(
      'does not take a K elsewhere in %s for the check digit',
      value => {
        expect(isValidRut(value)).toBe(false);
      }
    );
  });

  describe('isSameRut', () => {
    const plain = [
      '',
      '12.345.678-5',
      '123456785',
      ' 12345678-5 ',
      '12345678-9',
      '10.000.013-K',
      '10000013k',
      '7',
      '11.111.111-1',
    ];

    it('equals the normalized comparison for every pair of values without letters', () => {
      for (const left of plain)
        for (const right of plain)
          expect([left, right, isSameRut(left, right)]).toEqual([
            left,
            right,
            normalizeRut(left) === normalizeRut(right),
          ]);
      expect(isSameRut(undefined, '')).toBe(true);
    });

    it.each([
      ['P123456785', '12.345.678-5'],
      ['12.345.678-5', 'P123456785'],
      ['P123456785', 'P123456785'],
      ['1234567A', '123.456-7'],
    ])('never equals a value with letters: %s and %s', (left, right) => {
      expect(isSameRut(left, right)).toBe(false);
    });
  });

  describe('isSameDocument', () => {
    it('matches the same RUT and the same passport text, separators and case aside', () => {
      expect(isSameDocument('12.345.678-5', '123456785')).toBe(true);
      expect(isSameDocument('P123456785', ' p-123456785 ')).toBe(true);
    });

    it('never matches a passport with a RUT, or two passports that only share digits', () => {
      expect(isSameDocument('P123456785', '12.345.678-5')).toBe(false);
      expect(isSameDocument('P123456785', 'X123456785')).toBe(false);
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

describe('documentIdentityKey', () => {
  it('has exactly isSameDocument equality across RUT and passport values', () => {
    const corpus = [
      '12.345.678-5',
      '123456785',
      ' 12.345.678-5 ',
      '12.345.678-K',
      '12345678k',
      '12.345.678-k.',
      'K12345678',
      '123K45678',
      'P123456785',
      ' p-123.456785 ',
      'X123456785',
      'AB12345',
      'ab-12345',
      'P123/45',
      'P12345',
      'Ñ12345',
      'ñ12-345',
      '11.111.111-1',
    ];
    for (const left of corpus)
      for (const right of corpus) {
        expect({
          left,
          right,
          equal: documentIdentityKey(left) === documentIdentityKey(right),
        }).toEqual({ left, right, equal: isSameDocument(left, right) });
      }
  });

  it('gives no key to a value without digits, so markers never group two people', () => {
    for (const marker of [undefined, '', ' ', ' .- ', 'SIN RUT', 'S/R', 's/n', 'RN', 'K', 'k'])
      expect({ marker, key: documentIdentityKey(marker) }).toEqual({ marker, key: '' });
  });
});
