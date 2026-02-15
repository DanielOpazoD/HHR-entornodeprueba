import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDevMetrics } from '@/hooks/useDevMetrics';

describe('useDevMetrics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('should return default metrics when fetch fails', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('Network Error'));
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        const { result } = renderHook(() => useDevMetrics());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.metrics).not.toBeNull();
        // Since it used defaults (Statements: 66.94%), healthScore should be A for 100% tests
        expect(result.current.metrics?.healthScore).toBe('A');

        consoleSpy.mockRestore();
    });

    it('should fetch and update metrics from JSON files', async () => {
        const mockResults = {
            numTotalTests: 100,
            numPassedTests: 90,
            numFailedTests: 10
        };
        const mockCoverage = {
            numTotalTests: 100,
            coveredStatements: 50
        };

        vi.mocked(fetch).mockImplementation((url: any) => {
            if (url === '/test_results_current.json') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResults)
                } as any);
            }
            if (url === '/coverage_current.json') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockCoverage)
                } as any);
            }
            return Promise.resolve({ ok: false } as any);
        });

        const { result } = renderHook(() => useDevMetrics());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.metrics?.testStats.total).toBe(100);
        expect(result.current.metrics?.testStats.passed).toBe(90);
        expect(result.current.metrics?.testStats.successRate).toBe(90);
        expect(result.current.metrics?.healthScore).toBe('C');
    });

    it('should assign health score A for 100% tests and >60% coverage', async () => {
        vi.mocked(fetch).mockImplementation((_url: any) => {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ numTotalTests: 100, numPassedTests: 100, numFailedTests: 0 })
            } as any);
        });

        const { result } = renderHook(() => useDevMetrics());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.metrics?.healthScore).toBe('A');
    });
});
