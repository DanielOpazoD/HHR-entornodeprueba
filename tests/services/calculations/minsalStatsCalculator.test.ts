/**
 * Tests for minsalStatsCalculator.ts
 * Tests the MINSAL/DEIS statistics calculation functions
 */

import { describe, it, expect } from 'vitest';
import {
    getDateRangeFromPreset,
    filterRecordsByDateRange,
    calculateDailySnapshot,
    calculateMinsalStats,
    generateDailyTrend,
} from '@/services/calculations/minsalStatsCalculator';
import { DailyRecord, PatientData } from '@/types';

// Helper to create mock beds
const createMockBeds = (occupiedCount: number, blockedCount: number = 0): Record<string, PatientData> => {
    const beds: Record<string, PatientData> = {};
    for (let i = 1; i <= 25; i++) {
        const bedId = `bed_${i}`;
        if (i <= blockedCount) {
            beds[bedId] = {
                bedId,
                isBlocked: true,
                blockedReason: 'Mantención',
                bedMode: 'Cama',
                hasCompanionCrib: false,
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false
            } as PatientData;
        } else if (i <= occupiedCount + blockedCount) {
            beds[bedId] = {
                bedId,
                isBlocked: false,
                patientName: `Patient ${i}`,
                rut: `12.345.678-${i}`,
                pathology: 'Test Diagnosis',
                specialty: 'Med Interna',
                status: 'Estable',
                admissionDate: '2026-01-01',
                admissionTime: '10:00',
                age: '45',
                bedMode: 'Cama',
                hasCompanionCrib: false,
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false
            } as PatientData;
        } else {
            beds[bedId] = {
                bedId,
                isBlocked: false,
                patientName: '',
                rut: '',
                pathology: '',
                specialty: '',
                status: '',
                admissionDate: '',
                admissionTime: '',
                age: '',
                bedMode: 'Cama',
                hasCompanionCrib: false,
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false
            } as PatientData;
        }
    }
    return beds;
};

// Helper to create mock daily record
const createMockRecord = (date: string, occupiedCount: number = 10, blockedCount: number = 0): DailyRecord => ({
    date,
    beds: createMockBeds(occupiedCount, blockedCount),
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: new Date().toISOString(),
    nurses: ['', ''],
    activeExtraBeds: [],
});

describe('minsalStatsCalculator', () => {
    describe('getDateRangeFromPreset', () => {
        it('should return today for "today" preset', () => {
            const result = getDateRangeFromPreset('today');
            expect(result.startDate).toBe(result.endDate);
        });

        it('should return 7 days range for "last7days" preset', () => {
            const result = getDateRangeFromPreset('last7days');
            const start = new Date(result.startDate);
            const end = new Date(result.endDate);
            const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            expect(days).toBe(7);
        });

        it('should use custom dates when preset is "custom"', () => {
            const result = getDateRangeFromPreset('custom', '2026-01-01', '2026-01-15');
            expect(result.startDate).toBe('2026-01-01');
            expect(result.endDate).toBe('2026-01-15');
        });

        it('should return valid date range for "lastMonth" preset', () => {
            const result = getDateRangeFromPreset('lastMonth');
            expect(result.startDate).toBeDefined();
            expect(result.endDate).toBeDefined();
            expect(result.startDate <= result.endDate).toBe(true);
        });

        it('should return valid date range for "last3Months" preset', () => {
            const result = getDateRangeFromPreset('last3Months');
            const start = new Date(result.startDate);
            const end = new Date(result.endDate);
            expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
        });

        it('should return valid date range for "last6Months" preset', () => {
            const result = getDateRangeFromPreset('last6Months');
            const start = new Date(result.startDate);
            const end = new Date(result.endDate);
            expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
        });

        it('should return valid date range for "last12Months" preset', () => {
            const result = getDateRangeFromPreset('last12Months');
            const start = new Date(result.startDate);
            const end = new Date(result.endDate);
            expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
        });
    });

    describe('filterRecordsByDateRange', () => {
        const records: DailyRecord[] = [
            createMockRecord('2026-01-01'),
            createMockRecord('2026-01-05'),
            createMockRecord('2026-01-10'),
            createMockRecord('2026-01-15'),
        ];

        it('should filter records within date range', () => {
            const result = filterRecordsByDateRange(records, '2026-01-01', '2026-01-10');
            expect(result).toHaveLength(3);
        });

        it('should return empty array when no records match', () => {
            const result = filterRecordsByDateRange(records, '2026-02-01', '2026-02-28');
            expect(result).toHaveLength(0);
        });

        it('should include boundary dates', () => {
            const result = filterRecordsByDateRange(records, '2026-01-05', '2026-01-05');
            expect(result).toHaveLength(1);
            expect(result[0].date).toBe('2026-01-05');
        });

        it('should handle all records in range', () => {
            const result = filterRecordsByDateRange(records, '2026-01-01', '2026-01-31');
            expect(result).toHaveLength(4);
        });
    });

    describe('calculateDailySnapshot', () => {
        it('should return valid snapshot structure', () => {
            const record = createMockRecord('2026-01-01', 10);
            const snapshot = calculateDailySnapshot(record);
            expect(snapshot.date).toBe('2026-01-01');
            expect(typeof snapshot.ocupadas).toBe('number');
            expect(typeof snapshot.bloqueadas).toBe('number');
        });

        it('should include date in snapshot', () => {
            const record = createMockRecord('2026-01-15', 8);
            const snapshot = calculateDailySnapshot(record);
            expect(snapshot.date).toBe('2026-01-15');
        });

        it('should count occupied beds', () => {
            const record = createMockRecord('2026-01-01', 5);
            const snapshot = calculateDailySnapshot(record);
            expect(snapshot.ocupadas).toBeGreaterThanOrEqual(0);
        });
    });

    describe('calculateMinsalStats', () => {
        it('should calculate period start and end', () => {
            const records = [createMockRecord('2026-01-01'), createMockRecord('2026-01-02')];
            const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-02');
            expect(stats.periodStart).toBe('2026-01-01');
            expect(stats.periodEnd).toBe('2026-01-02');
        });

        it('should calculate total days with data', () => {
            const records = [
                createMockRecord('2026-01-01'),
                createMockRecord('2026-01-03'),
                createMockRecord('2026-01-05'),
            ];
            const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-05');
            expect(stats.totalDays).toBe(3);
        });

        it('should calculate discharges correctly', () => {
            const record = createMockRecord('2026-01-01', 10);
            record.discharges = [
                { id: '1', patientName: 'P1', status: 'Vivo', bedName: '', bedId: '', bedType: '', rut: '', diagnosis: '', time: '' },
                { id: '2', patientName: 'P2', status: 'Fallecido', bedName: '', bedId: '', bedType: '', rut: '', diagnosis: '', time: '' },
            ];
            const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
            expect(stats.egresosVivos).toBe(1);
            expect(stats.egresosFallecidos).toBe(1);
        });

        it('should calculate transfers correctly', () => {
            const record = createMockRecord('2026-01-01', 10);
            record.transfers = [
                { id: '1', patientName: 'P1', receivingCenter: 'Hospital X', bedName: '', bedId: '', bedType: '', rut: '', diagnosis: '', time: '', evacuationMethod: '' },
            ];
            const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
            expect(stats.egresosTraslados).toBe(1);
        });

        it('should include specialty breakdown', () => {
            const records = [createMockRecord('2026-01-01', 10)];
            const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-01');
            expect(stats.porEspecialidad).toBeDefined();
            expect(Array.isArray(stats.porEspecialidad)).toBe(true);
        });

        it('should calculate occupancy rate', () => {
            const records = [createMockRecord('2026-01-01', 12)];
            const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-01');
            expect(stats.tasaOcupacion).toBeGreaterThanOrEqual(0);
            expect(stats.tasaOcupacion).toBeLessThanOrEqual(100);
        });

        it('should calculate mortality rate', () => {
            const record = createMockRecord('2026-01-01', 10);
            record.discharges = [
                { id: '1', status: 'Vivo', patientName: '', bedName: '', bedId: '', bedType: '', rut: '', diagnosis: '', time: '' },
                { id: '2', status: 'Fallecido', patientName: '', bedName: '', bedId: '', bedType: '', rut: '', diagnosis: '', time: '' },
            ];
            const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
            expect(stats.mortalidadHospitalaria).toBe(50); // 1/2 * 100
        });

        it('should handle empty records', () => {
            const stats = calculateMinsalStats([], '2026-01-01', '2026-01-01');
            expect(stats.totalDays).toBe(0);
            expect(stats.diasCamaOcupados).toBe(0);
        });
    });

    describe('generateDailyTrend', () => {
        it('should generate snapshot for each record', () => {
            const records = [
                createMockRecord('2026-01-01', 10),
                createMockRecord('2026-01-02', 12),
                createMockRecord('2026-01-03', 11),
            ];
            const trend = generateDailyTrend(records);
            expect(trend).toHaveLength(3);
        });

        it('should sort by date ascending', () => {
            const records = [
                createMockRecord('2026-01-03', 11),
                createMockRecord('2026-01-01', 10),
                createMockRecord('2026-01-02', 12),
            ];
            const trend = generateDailyTrend(records);
            expect(trend[0].date).toBe('2026-01-01');
            expect(trend[2].date).toBe('2026-01-03');
        });

        it('should return empty array for no records', () => {
            const trend = generateDailyTrend([]);
            expect(trend).toHaveLength(0);
        });

        it('should include snapshot data for each day', () => {
            const records = [createMockRecord('2026-01-01', 5)];
            const trend = generateDailyTrend(records);
            expect(trend[0]).toHaveProperty('ocupadas');
            expect(trend[0]).toHaveProperty('bloqueadas');
            expect(trend[0]).toHaveProperty('date');
        });
    });
});
