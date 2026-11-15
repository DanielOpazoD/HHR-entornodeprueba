import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isRetryableError,
  errorService,
  logError,
  getUserFriendlyErrorMessage,
} from '@/services/utils/errorService';
import { classifyErrorForService } from '@/services/utils/errorServiceController';

describe('errorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    errorService.clearErrors();
  });

  describe('isRetryableError', () => {
    it('returns true for retryable codes', () => {
      expect(isRetryableError({ code: 'unavailable' })).toBe(true);
      expect(isRetryableError({ code: 'resource-exhausted' })).toBe(true);
    });

    it('returns false for non-retryable codes', () => {
      expect(isRetryableError({ code: 'permission-denied' })).toBe(false);
      expect(isRetryableError({})).toBe(false);
    });
  });

  describe('logError', () => {
    it('adds error to the service', () => {
      logError('Test error');
      const errors = errorService.getAllErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Test error');
    });
  });

  describe('getUserFriendlyErrorMessage', () => {
    it('translates firebase auth errors', () => {
      expect(getUserFriendlyErrorMessage({ code: 'auth/wrong-password' })).toContain('Contraseña');
    });

    it('translates network errors', () => {
      expect(getUserFriendlyErrorMessage({ message: 'network error' })).toContain('conexión');
    });

    it('returns default for unknown errors', () => {
      expect(getUserFriendlyErrorMessage({})).toContain('error');
    });
  });

  describe('classifyErrorForService', () => {
    it('classifies retryable firebase errors with severity and friendly message', () => {
      expect(classifyErrorForService({ code: 'unavailable', message: 'network down' })).toEqual(
        expect.objectContaining({
          severity: 'critical',
          retryable: true,
          userFriendlyMessage: expect.stringContaining('Servicio temporalmente no disponible'),
          code: 'unavailable',
        })
      );
    });
  });

  describe('ErrorService instance', () => {
    it('clears all errors', () => {
      logError('Error 1');
      logError('Error 2');
      expect(errorService.getAllErrors()).toHaveLength(2);

      errorService.clearErrors();
      expect(errorService.getAllErrors()).toHaveLength(0);
    });
  });
});
