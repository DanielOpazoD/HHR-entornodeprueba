import { describe, it, expect, vi } from 'vitest';
import {
    collectDailyCudyrPatients,
    buildDailyCudyrSummary,
    getCudyrMonthlyTotals
} from '@/services/calculations/cudyrSummary';
import { DailyRecord, BedType } from '@/types';

// Mock BEDS
vi.mock('@/constants', () => ({
    BEDS: [
        { id: 'R1', name: 'R1', type: 'UTI', isExtra: false },
        { id: 'M1', name: 'M1', type: 'MEDIA', isExtra: false },
        { id: 'EX1', name: 'EX1', type: 'MEDIA', isExtra: true }
    ]
}));

// Mock getCategorization
vi.mock('@/views/cudyr/CudyrScoreUtils', () => ({
    getCategorization: vi.fn((cudyr) => {
        if (!cudyr) return { finalCat: null, isCategorized: false };
        return { finalCat: 'A1', isCategorized: true };
    })
}));

describe('cudyrSummary', () => {
    const mockRecord: DailyRecord = {
        date: '2025-01-01',
        beds: {
            'R1': {
                bedId: 'R1',
                patientName: 'Patient 1',
                rut: '12345678-9',
                isBlocked: false,
                cudyr: { changeClothes: 1 } as any
            },
            'M1': {
                bedId: 'M1',
                patientName: 'Patient 2',
                rut: '98765432-1',
                isBlocked: false,
                cudyr: { changeClothes: 2 } as any,
                clinicalCrib: {
                    bedId: 'M1-crib',
                    patientName: 'Baby 1',
                    rut: 'RN',
                    isBlocked: false,
                    cudyr: { changeClothes: 0 } as any
                } as any
            }
        } as any,
        discharges: [],
        transfers: [],
        lastUpdated: 'now',
        nurses: [],
        activeExtraBeds: [],
        cma: []
    } as any;

    describe('collectDailyCudyrPatients', () => {
        it('should collect patients with CUDYR scores', () => {
            const patients = collectDailyCudyrPatients(mockRecord);
            expect(patients.length).toBeGreaterThan(0);
        });

        it('should include clinical cribs', () => {
            const patients = collectDailyCudyrPatients(mockRecord);
            const crib = patients.find(p => p.isCrib);
            expect(crib).toBeDefined();
        });

        it('should exclude blocked patients', () => {
            const blockedRecord: DailyRecord = {
                ...mockRecord,
                beds: {
                    'R1': { bedId: 'R1', patientName: 'Blocked', isBlocked: true }
                } as any
            };
            const patients = collectDailyCudyrPatients(blockedRecord);
            expect(patients.length).toBe(0);
        });

        it('should handle extra beds based on activeExtraBeds', () => {
            const recordWithExtra: DailyRecord = {
                ...mockRecord,
                activeExtraBeds: ['EX1'],
                beds: {
                    ...mockRecord.beds,
                    'EX1': { bedId: 'EX1', patientName: 'Extra', isBlocked: false, cudyr: {} } as any
                }
            };
            const patients = collectDailyCudyrPatients(recordWithExtra);
            expect(patients.some(p => p.bedId === 'EX1')).toBe(true);
        });
    });

    describe('buildDailyCudyrSummary', () => {
        it('should build summary with counts', () => {
            const summary = buildDailyCudyrSummary(mockRecord);
            expect(summary.date).toBe('2025-01-01');
            expect(summary.categorizedCount).toBeGreaterThan(0);
        });

        it('should separate UTI and MEDIA counts', () => {
            const summary = buildDailyCudyrSummary(mockRecord);
            expect(summary.utiTotal + summary.mediaTotal).toBe(summary.categorizedCount);
        });

        it('should process clinical cribs', () => {
            const summary = buildDailyCudyrSummary(mockRecord);
            // M1 patient + M1 crib = at least 2 categorized in MEDIA
            expect(summary.mediaTotal).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getCudyrMonthlyTotals', () => {
        it('should aggregate monthly data', async () => {
            const fetchFn = vi.fn().mockResolvedValue(mockRecord);

            const result = await getCudyrMonthlyTotals(2025, 1, '2025-01-05', fetchFn);

            expect(result.year).toBe(2025);
            expect(result.month).toBe(1);
            expect(fetchFn).toHaveBeenCalledTimes(5);
        });

        it('should use override record when date matches', async () => {
            const fetchFn = vi.fn().mockResolvedValue(null);
            const override = { ...mockRecord, date: '2025-01-01' };

            const result = await getCudyrMonthlyTotals(2025, 1, '2025-01-01', fetchFn, override);

            expect(result.dailySummaries.length).toBe(1);
            expect(fetchFn).not.toHaveBeenCalled(); // Used override
        });

        it('should handle no endDate (full month)', async () => {
            const fetchFn = vi.fn().mockResolvedValue(null);

            const result = await getCudyrMonthlyTotals(2025, 2, undefined, fetchFn);

            // February 2025 has 28 days
            expect(fetchFn).toHaveBeenCalledTimes(28);
            expect(result.dailySummaries.length).toBe(0); // All fetches returned null
        });

        it('should handle empty records', async () => {
            const fetchFn = vi.fn().mockResolvedValue(null);

            const result = await getCudyrMonthlyTotals(2025, 1, '2025-01-03', fetchFn);

            expect(result.totalCategorized).toBe(0);
            expect(result.totalOccupied).toBe(0);
        });
    });
});
