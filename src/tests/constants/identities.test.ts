// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { INSTITUTIONAL_ACCOUNTS, isInstitutionalAccount } from '@/constants/identities';

describe('identities', () => {
  describe('Constants', () => {
    it('should export INSTITUTIONAL_ACCOUNTS', () => {
      expect(INSTITUTIONAL_ACCOUNTS).toBeDefined();
      expect(INSTITUTIONAL_ACCOUNTS.NURSING).toContain('@hospitalhangaroa.cl');
    });
  });

  describe('isInstitutionalAccount', () => {
    it('should return true for nursing account', () => {
      expect(isInstitutionalAccount('hospitalizados@hospitalhangaroa.cl')).toBe(true);
    });

    it('should return true for alt nursing account', () => {
      expect(isInstitutionalAccount('enfermeria.hospitalizados@hospitalhangaroa.cl')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isInstitutionalAccount('HOSPITALIZADOS@hospitalhangaroa.CL')).toBe(true);
    });

    it('should handle whitespace', () => {
      expect(isInstitutionalAccount('  hospitalizados@hospitalhangaroa.cl  ')).toBe(true);
    });

    it('should return false for null', () => {
      expect(isInstitutionalAccount(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isInstitutionalAccount(undefined)).toBe(false);
    });

    it('should return false for non-institutional email', () => {
      expect(isInstitutionalAccount('random@gmail.com')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isInstitutionalAccount('')).toBe(false);
    });
  });
});
