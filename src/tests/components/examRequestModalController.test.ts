// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildExamRequestFooterFields,
  buildExamRequestFooterSection,
  buildExamRequestFormColumns,
  buildExamRequestModalShellModel,
} from '@/components/modals/controllers/examRequestModalController';
import type { PatientData } from '@/types/domain/patient';

const mockPatient = {
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  pathology: 'Neumonia',
  bedName: 'A1',
} as PatientData;

describe('examRequestModalController', () => {
  it('builds the shell model from patient data', () => {
    const result = buildExamRequestModalShellModel(mockPatient);

    expect(result.title).toBe('Solicitud de Laboratorio');
    expect(result.subtitle).toBe('Paciente Demo');
    expect(result.patientBedName).toBe('A1');
  });

  it('builds the exam request columns without duplicating green-tube exams', () => {
    const result = buildExamRequestFormColumns();

    expect(result).toHaveLength(3);
    expect(result[0].footerLabel).toBe('TUBO VERDE');
    expect(result[0].footerExams).toEqual(['ELECTROLITOS PLASMATICOS', 'LACTATO']);
    expect(result[1].sections[0].columns).toBe(2);
    expect(result[2].sections[1].title).toBe('Orina / Parásitos');
  });

  it('builds footer support data', () => {
    const footerSection = buildExamRequestFooterSection();
    const footerFields = buildExamRequestFooterFields();

    expect(footerSection.title).toContain('INMUNOLOGIA');
    expect(footerFields.map(field => field.label)).toEqual(['OTROS', 'MEDICO TRATANTE', 'FIRMA']);
  });
});
