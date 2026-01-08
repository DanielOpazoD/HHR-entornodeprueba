import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    withRetry,
    isRetryableError,
    errorService,
    logError,
    getUserFriendlyErrorMessage
} from '@/services/utils/errorService';

describe('errorService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        errorService.clearErrors();
    });

    describe('withRetry', () => {
        it('returns immediately on success', async () => {
            const fn = vi.fn().mockResolvedValue('success');
            const result = await withRetry(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries on retryable errors', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce({ code: 'unavailable' })
                .mockResolvedValue('success');

            const result = await withRetry(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('throws on non-retryable errors', async () => {
            const fn = vi.fn().mockRejectedValue({ code: 'permission-denied' });
            await expect(withRetry(fn)).rejects.toEqual({ code: 'permission-denied' });
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('calls onRetry callback', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce({ code: 'unavailable' })
                .mockResolvedValue('success');
            const onRetry = vi.fn();

            await withRetry(fn, { onRetry });
            expect(onRetry).toHaveBeenCalledWith(1, expect.any(Object));
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
