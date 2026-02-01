import { describe, it, expect, vi } from 'vitest';
import {
    validateCriticalFields,
    getMissingFieldsLabel,
    hasCriticalIssues
} from '@/services/validation/criticalFieldsValidator';
import { DailyRecord, PatientStatus, Specialty } from '@/types';

// Mock BEDS
vi.mock('@/constants', () => ({
    BEDS: [
        { id: 'R1', name: 'R1', type: 'UTI', isExtra: false },
        { id: 'M1', name: 'M1', type: 'MEDIA', isExtra: false },
        { id: 'EX1', name: 'EX1', type: 'MEDIA', isExtra: true }
    ]
}));

describe('criticalFieldsValidator', () => {
    const createPatient = (overrides: Partial<any> = {}) => ({
        bedId: 'R1',
        patientName: 'Test Patient',
        rut: '12345678-9',
        age: '45',
        pathology: 'Test',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2025-01-01',
        admissionTime: '10:00',
        devices: [],
        isBlocked: false,
        hasWristband: true,
        surgicalComplication: false,
        isUPC: false,
        bedMode: 'Cama' as const,
        hasCompanionCrib: false,
        ...overrides
    });

    const createRecord = (beds: Record<string, any>): DailyRecord => ({
        date: '2025-01-01',
        beds: beds as any,
        discharges: [],
        transfers: [],
        cma: [],
        nurses: [],
        lastUpdated: new Date().toISOString(),
        activeExtraBeds: []
    });

    describe('validateCriticalFields', () => {
        it('should return valid for complete patient data', () => {
            const record = createRecord({
                'R1': createPatient()
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it('should detect missing status', () => {
            const record = createRecord({
                'R1': createPatient({ status: '' })
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].missingFields).toContain('status');
        });

        it('should detect missing admissionDate', () => {
            const record = createRecord({
                'R1': createPatient({ admissionDate: '' })
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].missingFields).toContain('admissionDate');
        });

        it('should detect multiple missing fields', () => {
            const record = createRecord({
                'R1': createPatient({ status: '', admissionDate: '' })
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(false);
            expect(result.issues[0].missingFields).toHaveLength(2);
        });

        it('should ignore empty beds', () => {
            const record = createRecord({
                'R1': createPatient({ patientName: '', status: '', admissionDate: '' })
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(true);
        });

        it('should ignore blocked beds', () => {
            const record = createRecord({
                'R1': createPatient({ isBlocked: true, status: '', admissionDate: '' })
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(true);
        });

        it('should validate clinical crib patients', () => {
            const record = createRecord({
                'M1': {
                    ...createPatient(),
                    clinicalCrib: createPatient({
                        patientName: 'Baby',
                        status: '',
                        admissionDate: '2025-01-01'
                    })
                }
            });

            const result = validateCriticalFields(record);
            expect(result.isValid).toBe(false);
            expect(result.issues.some(i => i.isCrib)).toBe(true);
        });

        it('should count total issues', () => {
            const record = createRecord({
                'R1': createPatient({ status: '' }),
                'M1': createPatient({ admissionDate: '' })
            });

            const result = validateCriticalFields(record);
            expect(result.issueCount).toBe(2);
        });
    });

    describe('getMissingFieldsLabel', () => {
        it('should return status label', () => {
            expect(getMissingFieldsLabel(['status'])).toBe('Estado');
        });

        it('should return admissionDate label', () => {
            expect(getMissingFieldsLabel(['admissionDate'])).toBe('Fecha de ingreso');
        });

        it('should return combined labels', () => {
            const label = getMissingFieldsLabel(['status', 'admissionDate']);
            expect(label).toContain('Estado');
            expect(label).toContain('Fecha de ingreso');
        });
    });

    describe('hasCriticalIssues', () => {
        it('should return empty array for complete patient', () => {
            const record = createRecord({
                'R1': createPatient()
            });

            const issues = hasCriticalIssues(record, 'R1');
            expect(issues).toHaveLength(0);
        });

        it('should return missing fields for incomplete patient', () => {
            const record = createRecord({
                'R1': createPatient({ status: '' })
            });

            const issues = hasCriticalIssues(record, 'R1');
            expect(issues).toContain('status');
        });

        it('should check clinical crib if isCrib is true', () => {
            const record = createRecord({
                'M1': {
                    ...createPatient(),
                    clinicalCrib: createPatient({ admissionDate: '' })
                }
            });

            const issues = hasCriticalIssues(record, 'M1', true);
            expect(issues).toContain('admissionDate');
        });
    });
});
