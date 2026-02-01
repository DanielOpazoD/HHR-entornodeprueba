import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { performOptimisticUpdate, useOptimisticState } from '@/utils/optimisticUpdates';
import { logger } from '@/services';

vi.mock('@/services', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

describe('optimisticUpdates', () => {
    describe('performOptimisticUpdate', () => {
        it('should perform a successful update', async () => {
            const onOptimisticUpdate = vi.fn();
            const onSuccess = vi.fn();
            const updateFn = vi.fn().mockResolvedValue(undefined);
            const onError = vi.fn();

            const result = await performOptimisticUpdate({
                currentState: { count: 1 },
                optimisticState: { count: 2 },
                updateFn,
                onOptimisticUpdate,
                onSuccess,
                onError
            });

            expect(onOptimisticUpdate).toHaveBeenCalledWith({ count: 2 });
            expect(updateFn).toHaveBeenCalled();
            expect(onSuccess).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('should handle function as optimistic state', async () => {
            const onOptimisticUpdate = vi.fn();
            const updateFn = vi.fn().mockResolvedValue(undefined);

            await performOptimisticUpdate({
                currentState: 1,
                optimisticState: (c) => c + 1,
                updateFn,
                onOptimisticUpdate,
                onError: vi.fn()
            });

            expect(onOptimisticUpdate).toHaveBeenCalledWith(2);
        });

        it('should rollback on error', async () => {
            const onOptimisticUpdate = vi.fn();
            const updateFn = vi.fn().mockRejectedValue(new Error('Fail'));
            const onError = vi.fn();

            const result = await performOptimisticUpdate({
                currentState: { count: 1 },
                optimisticState: { count: 2 },
                updateFn,
                onOptimisticUpdate,
                onError
            });

            expect(onOptimisticUpdate).toHaveBeenCalledWith({ count: 2 });
            expect(onError).toHaveBeenCalledWith(expect.any(Error), { count: 1 });
            expect(result.success).toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('useOptimisticState', () => {
        it('should manage state with successful persistence', async () => {
            const persistFn = vi.fn().mockResolvedValue(undefined);
            const { result } = renderHook(() => useOptimisticState({
                initialState: 0,
                persistFn
            }));

            expect(result.current.state).toBe(0);

            let success;
            await act(async () => {
                success = await result.current.updateOptimistically(1);
            });

            expect(success).toBe(true);
            expect(result.current.state).toBe(1);
            expect(persistFn).toHaveBeenCalledWith(1);
            expect(result.current.isPending).toBe(false);
        });

        it('should rollback and set error on persistence failure', async () => {
            const persistFn = vi.fn().mockRejectedValue(new Error('Persist fail'));
            const onError = vi.fn();
            const { result } = renderHook(() => useOptimisticState({
                initialState: 10,
                persistFn,
                onError
            }));

            let success;
            await act(async () => {
                success = await result.current.updateOptimistically(20);
            });

            expect(success).toBe(false);
            expect(result.current.state).toBe(10); // Rolled back
            expect(result.current.error).toBeDefined();
            expect(onError).toHaveBeenCalled();
        });

        it('should allow manual rollback', async () => {
            const { result } = renderHook(() => useOptimisticState({
                initialState: 100,
                persistFn: vi.fn().mockResolvedValue(undefined)
            }));

            await act(async () => {
                await result.current.updateOptimistically(200);
            });

            act(() => {
                result.current.rollback();
            });

            expect(result.current.state).toBe(100);
        });

        it('should support functional updaters', async () => {
            const persistFn = vi.fn().mockResolvedValue(undefined);
            const { result } = renderHook(() => useOptimisticState({
                initialState: 5,
                persistFn
            }));

            await act(async () => {
                await result.current.updateOptimistically(c => c + 5);
            });

            expect(result.current.state).toBe(10);
        });
    });
});
