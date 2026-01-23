/**
 * Integration Tests for CUDYR Scoring
 * Tests the complete CUDYR categorization flow.
 */

import { describe, it, expect } from 'vitest';
import { PatientData, Specialty, PatientStatus } from '../../types';

// CUDYR Categories (Legacy context):
// C = Contagio (Infection)
// U = UPP/Caída (Pressure ulcer/Fall risk)
// D = Dependencia (Dependency)
// Y = Yatrogenia (Iatrogenic risk)
// R = Riesgo (General risk)

interface LegacyCudyrScore {
    C: boolean;
    U: boolean;
    D: boolean;
    Y: boolean;
    R: boolean;
}

describe('CUDYR Integration', () => {
    const createPatientWithCUDYR = (cudyr: LegacyCudyrScore): PatientData => ({
        bedId: 'R1',
        patientName: 'Test Patient',
        rut: '12345678-9',
        pathology: 'Test',
        age: '30',
        admissionDate: '2024-01-01',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        isBlocked: false,
        cudyr: cudyr as any, // Cast to any here is acceptable as we are testing legacy bridge in an integration context
    });

    describe('CUDYR Scoring', () => {
        it('should start with no categories', () => {
            const cudyr: LegacyCudyrScore = {
                C: false,
                U: false,
                D: false,
                Y: false,
                R: false,
            };

            const count = Object.values(cudyr).filter(Boolean).length;
            expect(count).toBe(0);
        });

        it('should count single category', () => {
            const cudyr: LegacyCudyrScore = {
                C: true,
                U: false,
                D: false,
                Y: false,
                R: false,
            };

            const count = Object.values(cudyr).filter(Boolean).length;
            expect(count).toBe(1);
        });

        it('should count multiple categories', () => {
            const cudyr: LegacyCudyrScore = {
                C: true,
                U: true,
                D: true,
                Y: false,
                R: false,
            };

            const count = Object.values(cudyr).filter(Boolean).length;
            expect(count).toBe(3);
        });

        it('should identify high-risk patient (all categories)', () => {
            const cudyr: LegacyCudyrScore = {
                C: true,
                U: true,
                D: true,
                Y: true,
                R: true,
            };

            const count = Object.values(cudyr).filter(Boolean).length;
            expect(count).toBe(5);

            const isHighRisk = count >= 3;
            expect(isHighRisk).toBe(true);
        });
    });

    describe('CUDYR Statistics', () => {
        it('should calculate index', () => {
            const patients = [
                createPatientWithCUDYR({ C: true, U: false, D: false, Y: false, R: false }),
                createPatientWithCUDYR({ C: true, U: true, D: false, Y: false, R: false }),
                createPatientWithCUDYR({ C: false, U: false, D: false, Y: false, R: false }),
            ];

            // Total categories marked
            const totalCategories = patients.reduce((sum, p) => {
                const cudyr = (p.cudyr as unknown as LegacyCudyrScore) || { C: false, U: false, D: false, Y: false, R: false };
                return sum + Object.values(cudyr).filter(Boolean).length;
            }, 0);

            expect(totalCategories).toBe(3); // 1 + 2 + 0
        });

        it('should calculate category frequency', () => {
            const patients = [
                createPatientWithCUDYR({ C: true, U: false, D: true, Y: false, R: false }),
                createPatientWithCUDYR({ C: true, U: true, D: true, Y: false, R: false }),
                createPatientWithCUDYR({ C: true, U: false, D: false, Y: false, R: true }),
            ];

            const getC = (p: PatientData) => (p.cudyr as unknown as LegacyCudyrScore)?.C;
            const getU = (p: PatientData) => (p.cudyr as unknown as LegacyCudyrScore)?.U;
            const getD = (p: PatientData) => (p.cudyr as unknown as LegacyCudyrScore)?.D;
            const getY = (p: PatientData) => (p.cudyr as unknown as LegacyCudyrScore)?.Y;
            const getR = (p: PatientData) => (p.cudyr as unknown as LegacyCudyrScore)?.R;

            expect(patients.filter(getC).length).toBe(3);
            expect(patients.filter(getU).length).toBe(1);
            expect(patients.filter(getD).length).toBe(2);
            expect(patients.filter(getY).length).toBe(0);
            expect(patients.filter(getR).length).toBe(1);
        });

        it('should identify most common category', () => {
            const patients = [
                createPatientWithCUDYR({ C: true, U: false, D: true, Y: false, R: false }),
                createPatientWithCUDYR({ C: false, U: true, D: true, Y: false, R: false }),
                createPatientWithCUDYR({ C: false, U: false, D: true, Y: true, R: false }),
            ];

            const categoryCounts = {
                C: patients.filter(p => (p.cudyr as unknown as LegacyCudyrScore)?.C).length,
                U: patients.filter(p => (p.cudyr as unknown as LegacyCudyrScore)?.U).length,
                D: patients.filter(p => (p.cudyr as unknown as LegacyCudyrScore)?.D).length,
                Y: patients.filter(p => (p.cudyr as unknown as LegacyCudyrScore)?.Y).length,
                R: patients.filter(p => (p.cudyr as unknown as LegacyCudyrScore)?.R).length,
            };

            const mostCommon = Object.entries(categoryCounts)
                .sort(([, a], [, b]) => b - a)[0];

            expect(mostCommon[0]).toBe('D'); // D appears in all 3
            expect(mostCommon[1]).toBe(3);
        });
    });

    describe('CUDYR in Daily Record', () => {
        it('should aggregate CUDYR for census', () => {
            const beds: Record<string, PatientData> = {
                'R1': createPatientWithCUDYR({ C: true, U: false, D: false, Y: false, R: false }),
                'R2': createPatientWithCUDYR({ C: true, U: true, D: false, Y: false, R: false }),
                'R3': {
                    bedId: 'R3',
                    patientName: '',
                    rut: '',
                    age: '',
                    admissionDate: '',
                    pathology: '',
                    specialty: Specialty.EMPTY,
                    status: PatientStatus.EMPTY,
                    hasWristband: false,
                    devices: [],
                    surgicalComplication: false,
                    isUPC: false,
                    bedMode: 'Cama',
                    hasCompanionCrib: false,
                    isBlocked: false
                } as PatientData, // Empty bed
            };

            const occupiedBeds = Object.values(beds).filter(b => b.patientName);
            const withCUDYR = occupiedBeds.filter(b =>
                b.cudyr && Object.values(b.cudyr as unknown as LegacyCudyrScore).some(Boolean)
            );

            expect(occupiedBeds.length).toBe(2);
            expect(withCUDYR.length).toBe(2);
        });

        it('should reset CUDYR when copying to new day', () => {
            const originalPatient = createPatientWithCUDYR({
                C: true, U: true, D: true, Y: false, R: false,
            });

            // Simulate copy to new day
            const copiedPatient: PatientData = {
                ...originalPatient,
                cudyr: undefined, // Reset for new day
            };

            expect(originalPatient.cudyr && (originalPatient.cudyr as unknown as LegacyCudyrScore).C).toBe(true);
            expect(copiedPatient.cudyr).toBeUndefined();
        });
    });
});
