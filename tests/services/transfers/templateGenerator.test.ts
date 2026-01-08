import { describe, it, expect } from 'vitest';
import { mapDataToTags } from '@/services/transfers/templateGeneratorService';
import { TransferPatientData, QuestionnaireResponse } from '@/types/transferDocuments';

describe('templateGeneratorService - mapDataToTags', () => {
    const mockPatient: TransferPatientData = {
        patientName: 'JUAN PEREZ ROSSI',
        rut: '12.345.678-9',
        birthDate: '1980-05-15',
        age: 45,
        diagnosis: 'NEUMONIA GRAVE',
        admissionDate: '2025-01-01',
        bedName: 'B-102',
        bedType: 'Básica',
        isUPC: false,
        originHospital: 'Hospital Hanga Roa'
    };

    const mockResponses: QuestionnaireResponse = {
        responses: [
            { questionId: 'contactoCovid', value: true },
            { questionId: 'sintomasCovid', value: ['Tos', 'Fiebre'] },
            { questionId: 'precaucionesAdicionales', value: false },
            { questionId: 'unidadesHospitalizacion', value: ['UPC (UCI/UTI)'] }
        ],
        completedAt: '2026-01-06T12:00:00Z',
        completedBy: 'Maria Gomez',
        attendingPhysician: 'Dr. Roberto Jara',
        diagnosis: 'NEUMONIA BACTERIANA EDITADA'
    };

    describe('Integridad de Datos Clínicos', () => {
        it('debe mapear correctamente el nombre, RUT y diagnóstico', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            expect(tags.paciente_nombre).toBe('JUAN PEREZ ROSSI');
            expect(tags.rut).toBe('12.345.678-9');
            // Debe usar el diagnóstico editado del cuestionario
            expect(tags.paciente_diagnostico).toBe('NEUMONIA BACTERIANA EDITADA');
        });

        it('debe calcular o usar la edad correctamente', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            expect(tags.paciente_edad).toBe('45 años');

            // Si la edad no viene pero sí la fecha de nacimiento
            const patientWithoutAge = { ...mockPatient, age: undefined };
            const tags2 = mapDataToTags(patientWithoutAge, mockResponses);
            expect(tags2.paciente_edad).toContain('años');
        });
    });

    describe('Robustez ante Datos Nulos/Incompletos', () => {
        it('debe manejar campos de paciente indefinidos graciosamente', () => {
            const emptyPatient: any = {
                patientName: 'PACIENTE SIN DATOS',
                rut: '',
                diagnosis: ''
            };
            const emptyResponses: QuestionnaireResponse = {
                responses: [],
                completedAt: '',
                completedBy: '',
                attendingPhysician: '',
                diagnosis: ''
            };

            const tags = mapDataToTags(emptyPatient, emptyResponses);
            expect(tags.paciente_rut).toBe('');
            expect(tags.paciente_edad).toBe('No registrada');
            expect(tags.medico_tratante).toBe('No especificado');
        });
    });

    describe('Precisión de Etiquetas Booleanas (_si/_no)', () => {
        it('debe generar etiquetas X para booleanos verdaderos', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            // contactoCovid es true en mockResponses
            expect(tags.contactoCovid_si).toBe('X');
            expect(tags.contactoCovid_no).toBe('');
            expect(tags.contactoCovid).toBe('Sí');
        });

        it('debe generar etiquetas X para booleanos falsos', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            // precaucionesAdicionales es false en mockResponses
            expect(tags.precaucionesAdicionales_si).toBe('');
            expect(tags.precaucionesAdicionales_no).toBe('X');
            expect(tags.precaucionesAdicionales).toBe('No');
        });
    });

    describe('Mapeo Específico COVID/IAAS', () => {
        it('debe mapear síntomas COVID individuales correctamente', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            // síntomas seleccionados: ['Tos', 'Fiebre']
            expect(tags.covid_tos_si).toBe('X');
            expect(tags.covid_fiebre_si).toBe('X');
            expect(tags.covid_anosmia_si).toBe('');
            expect(tags.covid_anosmia_no).toBe('X');
            expect(tags.covid_sintomas_presenta).toBe('Sí');
        });

        it('debe mapear unidades IAAS correctamente', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            // unidad: ['UPC (UCI/UTI)']
            expect(tags.iaas_unidad_upc).toBe('X');
            expect(tags.iaas_unidad_basica).toBe('');
        });
    });

    describe('Formato de Etiquetas (Modificadores)', () => {
        it('debe reemplazar guiones por guiones bajos en los IDs de las preguntas', () => {
            const responsesWithDashes: QuestionnaireResponse = {
                ...mockResponses,
                responses: [{ questionId: 'test-dash-id', value: 'valor' }]
            };
            const tags = mapDataToTags(mockPatient, responsesWithDashes);
            expect(tags.test_dash_id).toBe('valor');
        });

        it('debe unir arrays de multiselect con comas', () => {
            const tags = mapDataToTags(mockPatient, mockResponses);
            expect(tags.sintomasCovid).toBe('Tos, Fiebre');
        });
    });
});
