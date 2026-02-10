import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuditWorker } from '@/hooks/useAuditWorker';

// We need to mock the Worker, which is already done in setup.ts
describe('useAuditWorker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with empty results', () => {
        const { result } = renderHook(() => useAuditWorker());

        expect(result.current.results.filteredLogs).toEqual([]);
        expect(result.current.results.displayLogs).toEqual([]);
        expect(result.current.results.stats).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it('should have processData function', () => {
        const { result } = renderHook(() => useAuditWorker());

        expect(typeof result.current.processData).toBe('function');
    });

    it('should call processData without errors', () => {
        const { result } = renderHook(() => useAuditWorker());

        const mockLogs = [{ id: '1', action: 'TEST', userId: 'user1' }];
        const mockParams = { groupByAction: false, showCriticalOnly: false };
        const mockActionLabels = { TEST: 'Test Action' };
        const mockCriticalActions = ['CRITICAL'];

        // This should not throw
        act(() => {
            result.current.processData(
                mockLogs as any,
                mockParams as any,
                mockActionLabels,
                mockCriticalActions
            );
        });
    });
});
