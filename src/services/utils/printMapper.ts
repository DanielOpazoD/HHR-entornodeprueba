import { PatientData } from '@/types';
export interface SurveyData {
    diagnostico: string;
    peso: string;
    telefono: string;
    medicoTratante: string;
}
import { FieldDataSource } from '@/types/printTemplates';

export const mapSourceToValue = (
    source: FieldDataSource | undefined,
    data: {
        patient: PatientData;
        survey: SurveyData;
        bedName: string;
        prevision: string;
        selectedExams: Set<string>;
        manualValues: Record<string, string>;
    },
    fieldId: string
): string => {
    // Priority 1: Manual value if it exists for this specific instance
    if (data.manualValues[fieldId]) {
        return data.manualValues[fieldId];
    }

    if (!source) return '';

    // Priority 2: Automated mapping
    switch (source) {
        case 'patient.name':
            return data.patient.patientName || '';
        case 'patient.rut':
            return data.patient.rut || '';
        case 'patient.age':
            return data.patient.age?.toString() || '';
        case 'patient.birthDate':
            return data.patient.birthDate || '';
        case 'patient.sex':
            return data.patient.biologicalSex === 'Masculino' ? 'M' : 'F';
        case 'bed.name':
            return data.bedName;
        case 'today.date':
            return new Date().toLocaleDateString('es-CL');
        case 'survey.diagnosis':
            return data.survey.diagnostico;
        case 'survey.weight':
            return data.survey.peso ? `${data.survey.peso} kg` : '';
        case 'survey.phone':
            return data.survey.telefono;
        case 'survey.doctor':
            return data.survey.medicoTratante;
        case 'prevision':
            return data.prevision;
        case 'selectedExams':
            return Array.from(data.selectedExams).join(', ');
        default:
            return '';
    }
};
