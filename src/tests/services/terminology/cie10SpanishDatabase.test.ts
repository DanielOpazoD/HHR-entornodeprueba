import { describe, it, expect } from 'vitest';
import { searchCIE10Spanish, CIE10_SPANISH_DATABASE } from '@/services/terminology/cie10SpanishDatabase';

describe('cie10SpanishDatabase', () => {
    it('should have a large set of entries', () => {
        expect(CIE10_SPANISH_DATABASE.length).toBeGreaterThan(100);
    });

    it('should return empty array for short query', () => {
        expect(searchCIE10Spanish('a')).toEqual([]);
    });

    it('should find exact matches by code', () => {
        const results = searchCIE10Spanish('A09');
        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('A09');
    });

    it('should find matches by description', () => {
        const results = searchCIE10Spanish('diabetes');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].description.toLowerCase()).toContain('diabetes');
    });

    it('should find matches by partial description (prefix)', () => {
        const results = searchCIE10Spanish('diabe');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].description.toLowerCase()).toContain('diabetes');
    });

    it('should use fuzzy matching as fallback', () => {
        // "Diabetez" (with z) should still find Diabetes if fuzzy threshold is met
        const results = searchCIE10Spanish('diabetez');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].description.toLowerCase()).toContain('diabetes');
    });

    it('should limit results to 15', () => {
        const results = searchCIE10Spanish('fractura');
        expect(results.length).toBeLessThanOrEqual(15);
    });
});
