import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCachedAIResults, cacheAIResults, clearAICache, getCacheStats, getCachedQueries } from '@/services/terminology/aiResultsCache';

const CACHE_KEY = 'cie10_ai_cache';

describe('aiResultsCache', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('should return null when cache is empty', () => {
        expect(getCachedAIResults('diabetes')).toBeNull();
    });

    it('should cache and retrieve results', () => {
        const results = [{ code: 'E11', description: 'Diabetes', category: 'Endo' }];
        cacheAIResults('diabetes', results);

        const retrieved = getCachedAIResults('DIABETES '); // Test normalization
        expect(retrieved).toEqual(results);
    });

    it('should respect TTL', () => {
        const results = [{ code: 'E11', description: 'Diabetes' }];

        vi.useFakeTimers();
        cacheAIResults('diabetes', results);

        // Fast forward 25 hours (TTL is 24h)
        vi.advanceTimersByTime(25 * 60 * 60 * 1000);

        expect(getCachedAIResults('diabetes')).toBeNull();
        vi.useRealTimers();
    });

    it('should limit cache size', () => {
        const results = [{ code: 'X', description: 'X' }];

        // Fill cache past MAX_CACHE_ENTRIES=50
        for (let i = 0; i < 60; i++) {
            cacheAIResults(`query${i}`, results);
        }

        const queries = getCachedQueries();
        expect(queries.length).toBe(50);
    });

    it('should clear cache', () => {
        cacheAIResults('test', [{ code: '1', description: '1' }]);
        clearAICache();
        expect(getCachedAIResults('test')).toBeNull();
    });

    it('should return stats', () => {
        cacheAIResults('test', [{ code: '1', description: '1' }]);
        const stats = getCacheStats();
        expect(stats.entries).toBe(1);
        expect(stats.oldestAge).toBeGreaterThanOrEqual(0);
    });

    it('should handle corrupted JSON in localStorage', () => {
        localStorage.setItem(CACHE_KEY, 'invalid-json');
        expect(getCachedAIResults('test')).toBeNull();
    });
});
