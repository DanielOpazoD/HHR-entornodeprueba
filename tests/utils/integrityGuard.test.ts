import { describe, it, expect } from 'vitest';
import { calculateDensity, checkRegression } from '../../utils/integrityGuard';
import { DailyRecord } from '../../types';

describe('IntegrityGuard', () => {
    const createEmptyRecord = (date: string): DailyRecord => ({
        date,
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        nurses: ["", ""],
        activeExtraBeds: [],
        lastUpdated: new Date().toISOString(),
    });

    const createDenseRecord = (date: string): DailyRecord => ({
        date,
        beds: {
            'BED_01': {
                bedId: 'BED_01',
                patientName: 'John Doe',
                handoffNote: 'Stable patient',
                isBlocked: false,
                bedMode: 'Cama',
                hasCompanionCrib: false,
                rut: '123-4',
                age: '40',
                status: 'Estable',
                admissionDate: '2024-01-01',
                admissionTime: '10:00',
                hasWristband: true,
                devices: []
            } as any,
            'BED_02': {
                bedId: 'BED_02',
                patientName: 'Jane Smith',
                isBlocked: false,
                bedMode: 'Cama',
                hasCompanionCrib: false,
                rut: '567-8',
                age: '30',
                status: 'Grave',
                admissionDate: '2024-01-01',
                admissionTime: '11:00',
                hasWristband: true,
                devices: []
            } as any
        },
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
        novedadesDayShift: 'Some news'
    } as any);

    describe('calculateDensity', () => {
        it('should return 0 for null/undefined', () => {
            expect(calculateDensity(null)).toBe(0);
        });

        it('should return low score for empty record', () => {
            const empty = createEmptyRecord('2024-01-01');
            expect(calculateDensity(empty)).toBe(0);
        });

        it('should return high score for dense record', () => {
            const dense = createDenseRecord('2024-01-01');
            const density = calculateDensity(dense);
            expect(density).toBeGreaterThan(20);
        });
    });

    describe('checkRegression', () => {
        it('should NOT flag regression when oldRecord is null', () => {
            const newRecord = createDenseRecord('2024-01-01');
            const result = checkRegression(null, newRecord);
            expect(result.isSuspicious).toBe(false);
        });

        it('should flag regression when dense record is overwritten by empty one', () => {
            const oldRecord = createDenseRecord('2024-01-01');
            const newRecord = createEmptyRecord('2024-01-01');

            const result = checkRegression(oldRecord, newRecord);
            expect(result.isSuspicious).toBe(true);
            expect(result.dropPercentage).toBe(100);
        });

        it('should NOT flag regression when drop is minimal', () => {
            const oldRecord = createDenseRecord('2024-01-01');
            const newRecord = { ...oldRecord, beds: { ...oldRecord.beds } };
            // Remove one minor field
            delete (newRecord.beds['BED_01'] as any).handoffNote;

            const result = checkRegression(oldRecord, newRecord);
            expect(result.isSuspicious).toBe(false);
        });

        it('should flag regression when losing a substantial number of patients', () => {
            // Create a very dense record with 10 patients
            const oldRecord = createEmptyRecord('2024-01-01');
            for (let i = 0; i < 10; i++) {
                oldRecord.beds[`BED_${i}`] = { patientName: `Patient ${i}` } as any;
            }

            // New record only has 2 patients
            const newRecord = createEmptyRecord('2024-01-01');
            newRecord.beds['BED_0'] = { patientName: 'Patient 0' } as any;
            newRecord.beds['BED_1'] = { patientName: 'Patient 1' } as any;

            const result = checkRegression(oldRecord, newRecord);
            expect(result.isSuspicious).toBe(true);
            expect(result.dropPercentage).toBe(80);
        });
    });
});
