import { describe, it, expect } from 'vitest';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { PatientData, PatientStatus, Specialty } from '@/types';
import { HOSPITAL_CAPACITY } from '@/constants';

describe('statsCalculator', () => {
    const createEmptyBeds = (): Record<string, PatientData> => ({});

    it('should calculate empty hospital stats', () => {
        const stats = calculateStats(createEmptyBeds());
        expect(stats.occupiedBeds).toBe(0);
        expect(stats.totalHospitalized).toBe(0);
        expect(stats.serviceCapacity).toBe(HOSPITAL_CAPACITY);
    });

    it('should count occupied beds and blocked beds', () => {
        const beds: Record<string, PatientData> = {
            'R1': {
                patientName: 'John',
                isBlocked: false,
                bedMode: 'Cama',
                status: PatientStatus.ESTABLE,
                specialty: Specialty.MEDICINA,
            } as any,
            'R2': {
                patientName: '',
                isBlocked: true,
                bedMode: 'Cama'
            } as any
        };
        const stats = calculateStats(beds);
        expect(stats.occupiedBeds).toBe(1);
        expect(stats.blockedBeds).toBe(1);
        expect(stats.availableCapacity).toBe(HOSPITAL_CAPACITY - 1 - 1);
    });

    it('should handle Cuna mode and nested clinical cribs', () => {
        const beds: Record<string, PatientData> = {
            'R1': {
                patientName: 'Mother',
                bedMode: 'Cama',
                clinicalCrib: { patientName: 'Baby' }
            } as any,
            'R2': {
                patientName: 'RN Solo',
                bedMode: 'Cuna'
            } as any,
            'R3': {
                patientName: 'Mother 2',
                bedMode: 'Cama',
                hasCompanionCrib: true
            } as any
        };
        const stats = calculateStats(beds);

        // R1: 1 Bed + 1 Nested Crib
        // R2: 1 Bed (Cuna mode)
        // R3: 1 Bed + 1 Companion Crib

        expect(stats.occupiedBeds).toBe(3);
        expect(stats.occupiedCribs).toBe(1);
        expect(stats.totalHospitalized).toBe(4);
        expect(stats.clinicalCribsCount).toBe(2); // R1 nested + R2 main
        expect(stats.companionCribs).toBe(1); // R3
        expect(stats.totalCribsUsed).toBe(3); // R1 nested + R2 main + R3 companion
    });

    it('should count empty beds in Cuna mode as crib usage', () => {
        const beds: Record<string, PatientData> = {
            'R1': { patientName: '', bedMode: 'Cuna' } as any
        };
        const stats = calculateStats(beds);
        expect(stats.occupiedBeds).toBe(0);
        expect(stats.totalCribsUsed).toBe(1);
    });
});
