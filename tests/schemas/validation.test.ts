import { describe, it, expect } from 'vitest';
import {
    validatePatientData,
    validateDailyRecord,
    validateBackupData,
    validateRut,
    validateAdmissionDate,
    validateCudyrScore
} from '@/schemas/validation';
import { Specialty, PatientStatus } from '@/types';

describe('validation schema helpers', () => {
    describe('validateRut', () => {
        it('should return true for empty or null RUT', () => {
            expect(validateRut('')).toBe(true);
            expect(validateRut(null as any)).toBe(true);
        });

        it('should return true for valid RUT format', () => {
            expect(validateRut('12.345.678-9')).toBe(true);
            expect(validateRut('12345678-9')).toBe(true);
            expect(validateRut('123456789')).toBe(true);
        });

        it('should return false for invalid RUT format', () => {
            expect(validateRut('not-a-rut')).toBe(false);
        });
    });

    describe('validateAdmissionDate', () => {
        it('should return success for empty date', () => {
            const result = validateAdmissionDate('');
            expect(result.success).toBe(true);
            expect(result.data).toBe('');
        });

        it('should return error for invalid format', () => {
            const result = validateAdmissionDate('2025/01/01');
            expect(result.success).toBe(false);
            expect(result.errors).toContain('Formato de fecha inválido (YYYY-MM-DD)');
        });

        it('should return error for future date', () => {
            const futureDate = '2099-01-01';
            const result = validateAdmissionDate(futureDate);
            expect(result.success).toBe(false);
            expect(result.errors).toContain('La fecha de ingreso no puede ser futura');
        });

        it('should return success for valid past date', () => {
            const result = validateAdmissionDate('2020-01-01');
            expect(result.success).toBe(true);
            expect(result.data).toBe('2020-01-01');
        });
    });

    describe('validatePatientData', () => {
        it('should validate valid patient data', () => {
            const validData = {
                bedId: 'R1',
                isBlocked: false,
                patientName: 'Test',
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false,
                bedMode: 'Cama'
            };
            const result = validatePatientData(validData);
            expect(result.success).toBe(true);
        });

        it('should return errors for invalid patient data', () => {
            const invalidData = {
                bedId: '', // error: min 1
                isBlocked: 'not-a-boolean' // error: expected boolean
            };
            const result = validatePatientData(invalidData);
            expect(result.success).toBe(false);
            expect(result.errors?.length).toBeGreaterThan(0);
        });
    });

    describe('validateDailyRecord', () => {
        it('should validate valid daily record', () => {
            const validData = {
                date: '2025-01-01',
                beds: {},
                discharges: [],
                transfers: [],
                lastUpdated: new Date().toISOString()
            };
            const result = validateDailyRecord(validData);
            expect(result.success).toBe(true);
        });

        it('should return errors for invalid daily record', () => {
            const invalidData = {
                date: 'invalid-date',
                beds: 'not-an-object'
            };
            const result = validateDailyRecord(invalidData);
            expect(result.success).toBe(false);
            expect(result.errors?.length).toBeGreaterThan(0);
        });
    });

    describe('validateBackupData', () => {
        it('should validate valid backup data', () => {
            const validData = {
                '2025-01-01': {
                    date: '2025-01-01',
                    beds: {},
                    lastUpdated: new Date().toISOString()
                }
            };
            const result = validateBackupData(validData);
            expect(result.success).toBe(true);
        });
    });

    describe('validateCudyrScore', () => {
        it('should validate valid score', () => {
            const validScore = {
                changeClothes: 1,
                mobilization: 2,
                feeding: 3,
                elimination: 4,
                psychosocial: 0,
                surveillance: 1,
                vitalSigns: 2,
                fluidBalance: 3,
                oxygenTherapy: 4,
                airway: 0,
                proInterventions: 1,
                skinCare: 2,
                pharmacology: 3,
                invasiveElements: 4
            };
            const result = validateCudyrScore(validScore);
            expect(result.success).toBe(true);
        });

        it('should return errors for out of bounds values', () => {
            const invalidScore = {
                changeClothes: 5, // max 4
                mobilization: -1 // min 0
            };
            const result = validateCudyrScore(invalidScore);
            expect(result.success).toBe(false);
            expect(result.errors?.length).toBeGreaterThan(0);
        });

        it('should return errors for missing fields', () => {
            const incompleteScore = {
                changeClothes: 1
            };
            const result = validateCudyrScore(incompleteScore);
            expect(result.success).toBe(false);
        });
    });

    describe('Edge Cases for Branch Coverage', () => {
        it('validatePatientData should handle nested clinicalCrib', () => {
            const patientWithCrib = {
                bedId: 'M1',
                isBlocked: false,
                hasWristband: true,
                devices: [],
                surgicalComplication: false,
                isUPC: false,
                bedMode: 'Cama',
                clinicalCrib: {
                    bedId: 'M1-Crib',
                    isBlocked: false,
                    hasWristband: false,
                    devices: [],
                    surgicalComplication: false,
                    isUPC: false,
                    bedMode: 'Cuna'
                }
            };
            const result = validatePatientData(patientWithCrib);
            expect(result.success).toBe(true);
        });

        it('validateDailyRecord should handle all optional fields', () => {
            const recordWithOptionals = {
                date: '2025-01-01',
                beds: {},
                discharges: [],
                transfers: [],
                lastUpdated: new Date().toISOString(),
                nurseName: 'Test Nurse',
                nursesDayShift: ['Ana', 'Pedro'],
                nursesNightShift: ['Luis'],
                tensDayShift: ['Maria'],
                tensNightShift: [],
                handoffDayChecklist: { item1: true },
                handoffNovedadesDayShift: 'Sin novedades',
                handoffNightChecklist: { item2: false },
                handoffNovedadesNightShift: 'Paciente estable',
                medicalHandoffDoctor: 'Dr. Test',
                medicalHandoffSentAt: '10:00',
                medicalSignature: {
                    doctorName: 'Dr. Test',
                    signedAt: '10:05',
                    userAgent: 'Chrome'
                }
            };
            const result = validateDailyRecord(recordWithOptionals);
            expect(result.success).toBe(true);
        });

        it('validateAdmissionDate should handle whitespace-only strings', () => {
            const result = validateAdmissionDate('   ');
            expect(result.success).toBe(true);
            expect(result.data).toBe('');
        });

        it('validateRut should handle whitespace-only strings', () => {
            expect(validateRut('   ')).toBe(true);
        });

        it('validateRut should accept RUT with K verifier', () => {
            expect(validateRut('12.345.678-K')).toBe(true);
            expect(validateRut('12345678K')).toBe(true);
        });

        it('validateBackupData should fail for nested invalid records', () => {
            const invalidBackup = {
                '2025-01-01': {
                    date: 'not-a-date', // Invalid
                    beds: {},
                    lastUpdated: 'now'
                }
            };
            const result = validateBackupData(invalidBackup);
            expect(result.success).toBe(false);
        });
    });
});
