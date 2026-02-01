import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiRequestManager } from '@/services/ai/aiRequestManager';

describe('AIRequestManager', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should execute requests and return result', async () => {
        const recipe = vi.fn().mockResolvedValue('success');
        const result = await aiRequestManager.enqueue('task-simple', recipe);
        expect(result).toBe('success');
        expect(recipe).toHaveBeenCalled();
    });

    it('should handle abort signal', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(aiRequestManager.enqueue('abort-task-simple', () => Promise.resolve('ok'), controller.signal))
            .rejects.toThrow();
    });

    it('should handle errors', async () => {
        const recipe = vi.fn().mockRejectedValue(new Error('API Error'));
        await expect(aiRequestManager.enqueue('fail-task-simple', recipe))
            .rejects.toThrow('API Error');
    });
});
