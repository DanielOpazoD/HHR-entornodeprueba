import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '@/utils/networkUtils';

describe('networkUtils', () => {
    it('should return result if first attempt succeeds', async () => {
        const fn = vi.fn().mockResolvedValue('success');
        const result = await withRetry(fn);
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue('success');

        const result = await withRetry(fn, { initialDelay: 10 });
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw last error if all retries fail', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('final fail'));
        await expect(withRetry(fn, { maxRetries: 2, initialDelay: 1 })).rejects.toThrow('final fail');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback', async () => {
        const onRetry = vi.fn();
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValue('success');

        await withRetry(fn, { onRetry, initialDelay: 1 });
        expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 1);
    });
});
