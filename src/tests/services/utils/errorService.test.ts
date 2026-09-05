import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
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

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns immediately on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ code: 'unavailable' })
        .mockResolvedValue('success');

      const pendingResult = withRetry(fn);
      await vi.advanceTimersByTimeAsync(499);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
      const result = await pendingResult;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws on non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue({ code: 'permission-denied' });
      await expect(withRetry(fn)).rejects.toEqual({ code: 'permission-denied' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ code: 'unavailable' })
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      const pendingResult = withRetry(fn, { onRetry });
      await vi.runAllTimersAsync();
      await pendingResult;
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Object));
    });

    it('throws the final retryable error after exhausting the default retries', async () => {
      const finalError = { code: 'unavailable', message: 'Still unavailable' };
      const fn = vi.fn().mockRejectedValue(finalError);
      const rejection = expect(withRetry(fn)).rejects.toBe(finalError);

      await vi.runAllTimersAsync();
      await rejection;

      expect(fn).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    });
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
