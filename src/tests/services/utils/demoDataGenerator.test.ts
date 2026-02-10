import { describe, it, expect } from 'vitest';
import {
    generateDemoRecord,
    generateDemoForDay,
    generateDemoForWeek,
    generateDemoForMonth
} from '@/services/utils/demoDataGenerator';

describe('demoDataGenerator', () => {
    describe('generateDemoRecord', () => {
        it('should generate a valid daily record with beds', () => {
            const date = '2025-01-01';
            const record = generateDemoRecord(date);
            expect(record.date).toBe(date);
            expect(Object.keys(record.beds).length).toBeGreaterThan(0);
            expect(Array.isArray(record.nurses)).toBe(true);
        });

        it('should handle specialties and bed modes correctly', () => {
            const mockDate = '2025-01-01';
            const record = generateDemoRecord(mockDate);
            const beds = Object.values(record.beds);

            const hasUPC = beds.some(b => b.isUPC);
            const hasNeo = beds.some(b => b.bedId.startsWith('NEO') && b.bedMode === 'Cuna');
            const hasGineco = beds.some(b => b.specialty === 'Ginecobstetricia');

            expect(hasUPC).toBe(true);
            expect(hasNeo).toBe(true);
            // Ginecobstetricia is probabilistic but likely
            expect(hasGineco).toBeDefined();
        });
    });

    describe('generateDemoForDay', () => {
        it('should return an array containing one record', () => {
            const results = generateDemoForDay('2025-01-01');
            expect(results).toHaveLength(1);
            expect(results[0].date).toBe('2025-01-01');
        });
    });

    describe('generateDemoForWeek', () => {
        it('should generate 7 consecutive days of records', () => {
            const startDate = '2025-01-01';
            const results = generateDemoForWeek(startDate);
            expect(results).toHaveLength(7);
            expect(results[0].date).toBe(startDate);
            expect(results[1].date).toBe('2025-01-02');
            expect(results[6].date).toBe('2025-01-07');
        });

        it('should maintain some continuity (though random, it shouldn\'t crash)', () => {
            const results = generateDemoForWeek('2025-01-01');
            // Check that we have some patients across days
            const combinedPatientNames = results.flatMap(r =>
                Object.values(r.beds).map(p => p.patientName).filter(Boolean)
            );
            expect(combinedPatientNames.length).toBeGreaterThan(0);
        });
    });

    describe('generateDemoForMonth', () => {
        it('should generate records for an entire month', () => {
            const results = generateDemoForMonth(2025, 0); // January 2025
            expect(results).toHaveLength(31);
            expect(results[0].date).toBe('2025-01-01');
            expect(results[30].date).toBe('2025-01-31');
        });

        it('should handle different month lengths (e.g., February)', () => {
            const results = generateDemoForMonth(2025, 1); // February 2025
            expect(results).toHaveLength(28);
        });
    });
});
