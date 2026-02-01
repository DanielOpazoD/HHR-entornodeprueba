import { describe, it, expect } from 'vitest';
import { mapSourceToValue } from '@/services/utils/printMapper';

describe('printMapper', () => {
    const mockData = {
        patient: {
            patientName: 'John Doe',
            rut: '1.234.567-8',
            age: 30,
            biologicalSex: 'Masculino',
            birthDate: '1995-01-01'
        } as any,
        survey: {
            diagnostico: 'Test Diagnosis',
            peso: 70,
            telefono: '123456',
            medicoTratante: 'Dr. Smith'
        } as any,
        bedName: 'Bed 1',
        prevision: 'Fonasa',
        selectedExams: new Set(['Exam A', 'Exam B']),
        manualValues: {}
    };

    it('should return manual value if present', () => {
        const dataWithManual = { ...mockData, manualValues: { 'field-1': 'Manual' } };
        expect(mapSourceToValue(undefined, dataWithManual, 'field-1')).toBe('Manual');
    });

    it('should map patient data correctly', () => {
        expect(mapSourceToValue('patient.name', mockData, 'f')).toBe('John Doe');
        expect(mapSourceToValue('patient.rut', mockData, 'f')).toBe('1.234.567-8');
        expect(mapSourceToValue('patient.sex', mockData, 'f')).toBe('M');
        expect(mapSourceToValue('patient.age', mockData, 'f')).toBe('30');
    });

    it('should map survey data correctly', () => {
        expect(mapSourceToValue('survey.diagnosis', mockData, 'f')).toBe('Test Diagnosis');
        expect(mapSourceToValue('survey.weight', mockData, 'f')).toBe('70 kg');
    });

    it('should map other fields', () => {
        expect(mapSourceToValue('bed.name', mockData, 'f')).toBe('Bed 1');
        expect(mapSourceToValue('prevision', mockData, 'f')).toBe('Fonasa');
        expect(mapSourceToValue('selectedExams', mockData, 'f')).toBe('Exam A, Exam B');
    });

    it('should return empty for unknown source', () => {
        expect(mapSourceToValue('unknown' as any, mockData, 'f')).toBe('');
    });

    it('should handle undefined source', () => {
        expect(mapSourceToValue(undefined, mockData, 'f')).toBe('');
    });

    it('should handle missing fields in survey', () => {
        const emptySurvey = { ...mockData, survey: {} as any };
        expect(mapSourceToValue('survey.weight', emptySurvey, 'f')).toBe('');
    });
});
