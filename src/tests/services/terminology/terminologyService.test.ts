import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchDiagnoses, getCIE10Description, forceAISearch } from '@/services/terminology/terminologyService';
import * as db from '@/services/terminology/cie10SpanishDatabase';
import * as ai from '@/services/terminology/cie10AISearch';
import * as cache from '@/services/terminology/aiResultsCache';

vi.mock('@/services/terminology/cie10SpanishDatabase', () => ({
    searchCIE10Spanish: vi.fn(),
    CIE10_SPANISH_DATABASE: [
        { code: 'E11', description: 'Diabetes', category: 'Endocrino' },
        { code: 'J44', description: 'EPOC', category: 'Resp' }
    ]
}));

vi.mock('@/services/terminology/cie10AISearch', () => ({
    searchCIE10WithAI: vi.fn()
}));

vi.mock('@/services/terminology/aiResultsCache', () => ({
    getCachedAIResults: vi.fn(),
    cacheAIResults: vi.fn()
}));

describe('terminologyService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('searchDiagnoses', () => {
        it('should return empty array if query is too short', async () => {
            const results = await searchDiagnoses('a');
            expect(results).toEqual([]);
        });

        it('should return local results if no cache exists', async () => {
            const mockEntry = { code: 'E11', description: 'Diabetes', category: 'Endocrino' };
            vi.mocked(db.searchCIE10Spanish).mockReturnValue([mockEntry]);
            vi.mocked(cache.getCachedAIResults).mockReturnValue(null);

            const results = await searchDiagnoses('diab');

            expect(results).toHaveLength(1);
            expect(results[0].code).toBe('E11');
            expect(results[0].fromAI).toBe(false);
        });

        it('should prioritize cached AI results and merge with unique local results', async () => {
            const localEntry = { code: 'E11', description: 'Diabetes', category: 'Endocrino' };
            const aiEntry = { code: 'E11.5', description: 'Diabetes con complicaciones', category: 'Endocrino' };

            vi.mocked(db.searchCIE10Spanish).mockReturnValue([localEntry]);
            vi.mocked(cache.getCachedAIResults).mockReturnValue([aiEntry]);

            const results = await searchDiagnoses('diab');

            expect(results).toHaveLength(2);
            expect(results[0].code).toBe('E11.5');
            expect(results[0].fromAI).toBe(true);
            expect(results[1].code).toBe('E11');
            expect(results[1].fromAI).toBe(false);
        });
    });

    describe('getCIE10Description', () => {
        it('should return description for a known code', () => {
            expect(getCIE10Description('E11')).toBe('Diabetes');
        });

        it('should return null for unknown code', () => {
            expect(getCIE10Description('XYZ')).toBeNull();
        });

        it('should return null for empty code', () => {
            expect(getCIE10Description('')).toBeNull();
        });
    });

    describe('forceAISearch', () => {
        it('should call AI and update cache', async () => {
            const aiEntry = { code: 'I10', description: 'HTA', category: 'Cardio' };
            vi.mocked(db.searchCIE10Spanish).mockReturnValue([]);
            vi.mocked(ai.searchCIE10WithAI).mockResolvedValue([aiEntry]);

            const results = await forceAISearch('hta');

            expect(ai.searchCIE10WithAI).toHaveBeenCalledWith('hta', undefined);
            expect(cache.cacheAIResults).toHaveBeenCalledWith('hta', [aiEntry]);
            expect(results).toHaveLength(1);
            expect(results[0].fromAI).toBe(true);
        });

        it('should handle AI errors gracefully', async () => {
            vi.mocked(ai.searchCIE10WithAI).mockRejectedValue(new Error('AI fail'));
            const results = await forceAISearch('hta');
            expect(results).toEqual([]);
        });
    });
});
