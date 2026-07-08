import { describe, expect, it } from 'vitest';
import {
  buildClinicalDocumentPdfFileName,
  formatClinicalDocumentAuthorName,
  formatClinicalDocumentDateTime,
  getClinicalDocumentPatientFieldLabel,
  hydrateClinicalDocumentWorkspaceRecord,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

const buildRecord = () =>
  createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'doctor_urgency',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11.111.111-1__2026-03-06',
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: 'Medicina',
    },
    patientFieldValues: {
      nombre: 'Paciente Test',
      rut: '11.111.111-1',
      edad: '40a',
      fecnac: '1986-01-01',
      fing: '2026-03-06',
      finf: '2026-03-06',
      hinf: '10:30',
    },
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  });

describe('clinicalDocumentWorkspaceController', () => {
  it('hydrates legacy defaults and epicrisis section labels', () => {
    const record = buildRecord();
    record.patientInfoTitle = '';
    record.footerMedicoLabel = '';
    record.footerEspecialidadLabel = '';

    const hydrated = hydrateClinicalDocumentWorkspaceRecord(record);

    expect(hydrated.patientInfoTitle).toBe('Información del Paciente');
    expect(hydrated.footerMedicoLabel).toBe('Médico');
    expect(hydrated.footerEspecialidadLabel).toBe('Especialidad');
    expect(hydrated.sections.some(section => section.title === 'Diagnósticos de egreso')).toBe(
      true
    );
    expect(hydrated.sections.some(section => section.title === 'Indicaciones al alta')).toBe(true);
  });

  it('renames the epicrisis report date field to Fecha de alta', () => {
    const field = { id: 'finf', label: 'Fecha del informe', value: '', type: 'date' as const };
    expect(getClinicalDocumentPatientFieldLabel(field, 'epicrisis')).toBe('Fecha de alta');
  });

  it('formats timestamps without seconds', () => {
    expect(formatClinicalDocumentDateTime('2026-03-06T15:45:10.000Z')).toMatch(/\d{2}.*\d{2}/);
  });

  it('builds the PDF file name from clinical date and patient name', () => {
    const record = buildRecord();
    record.patientName = 'Felipe Reyes Opazo';
    record.patientFields = record.patientFields.map(field =>
      field.id === 'nombre'
        ? { ...field, value: 'Felipe Reyes Opazo' }
        : field.id === 'finf'
          ? { ...field, value: '2026-03-08' }
          : field
    );

    expect(buildClinicalDocumentPdfFileName(record)).toBe('08-03-2026 - Felipe Reyes Opazo.pdf');
  });

  it('formats author names as first name plus first surname', () => {
    expect(formatClinicalDocumentAuthorName('Juan Pablo Perez Soto')).toBe('Juan Perez');
    expect(formatClinicalDocumentAuthorName('Ana Perez')).toBe('Ana Perez');
  });
});
