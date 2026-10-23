/**
 * Tests for audit.ts types and utilities
 * Tests the maskRut function for privacy protection
 */

import { describe, it, expect } from 'vitest';
import { maskRut } from '@/types/auditLogTypes';

describe('audit types', () => {
  describe('maskRut', () => {
    it('should mask full RUT with verifier digit', () => {
      const masked = maskRut('12.345.678-9');
      expect(masked).toBe('12.345.***-*');
    });

    it('should mask RUT without dots', () => {
      const masked = maskRut('12345678-9');
      expect(masked).toBe('12345***-*');
    });

    it('should mask RUT with K verifier', () => {
      const masked = maskRut('12.345.678-K');
      expect(masked).toBe('12.345.***-*');
    });

    it('should return *** for empty string', () => {
      const masked = maskRut('');
      expect(masked).toBe('***');
    });

    it('should return *** for very short RUT', () => {
      const masked = maskRut('12');
      expect(masked).toBe('***');
    });

    it('should handle RUT without hyphen', () => {
      const masked = maskRut('123456789');
      expect(masked).toBe('12345***');
    });

    it('should handle undefined-like input', () => {
      const masked = maskRut(null as unknown as string);
      expect(masked).toBe('***');
    });

    it('should mask correctly for minimum valid length', () => {
      const masked = maskRut('1234');
      expect(masked.includes('***')).toBe(true);
    });

    it('should preserve first digits for longer RUTs', () => {
      const masked = maskRut('22.222.222-2');
      expect(masked.startsWith('22.222')).toBe(true);
    });
  });
});
