import { describe, expect, it } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import {
  formatClinicalDocumentContractIssues,
  parseClinicalDocumentRecord,
  parseClinicalDocumentTemplate,
  safeParseClinicalDocumentRecord,
  safeParseClinicalDocumentTemplate,
} from '@/features/clinical-documents/contracts/clinicalDocumentRuntimeContracts';
import { CLINICAL_DOCUMENT_TEMPLATES } from '@/features/clinical-documents/domain/rules';

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
      specialty: 'Cirugía',
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
    especialidad: 'Cirugía',
  });

describe('clinicalDocumentRuntimeContracts', () => {
  it('accepts a normalized clinical document record', () => {
    const record = buildRecord();

    expect(parseClinicalDocumentRecord(record).id).toBe(record.id);
  });

  it('rejects a record without required identifiers', () => {
    const record: Partial<ClinicalDocumentRecord> = { ...buildRecord() };
    delete record.id;

    expect(() => parseClinicalDocumentRecord(record as ClinicalDocumentRecord)).toThrow();
  });

  it('keeps new-write audit actor parsing strict', () => {
    const record = buildRecord();
    const createdBy = {
      uid: record.audit.createdBy.uid,
      email: record.audit.createdBy.email,
    };

    expect(
      safeParseClinicalDocumentRecord({
        ...record,
        audit: {
          ...record.audit,
          createdBy,
        },
      }).success
    ).toBe(false);
  });

  it('accepts default clinical document templates', () => {
    expect(parseClinicalDocumentTemplate(CLINICAL_DOCUMENT_TEMPLATES.epicrisis).id).toBe(
      'epicrisis'
    );
  });

  it('preserves IEEH-only doctor override fields', () => {
    const record = parseClinicalDocumentRecord({
      ...buildRecord(),
      ieehDraft: {
        cie10Code: 'A00',
        cie10Description: 'Cólera',
        diagnosticoPrincipal: 'Cólera',
        condicionEgreso: '1',
        intervencionQuirurgica: '2',
        procedimiento: '2',
        tratanteNombreCompleto: 'Pérez Soto Ana María',
        tratanteEspecialidad: 'Cirugía Adulto',
        tratanteRut: '12.345.678-9',
      },
    });

    expect(record.ieehDraft?.tratanteNombreCompleto).toBe('Pérez Soto Ana María');
    expect(record.ieehDraft?.tratanteEspecialidad).toBe('Cirugía Adulto');
    expect(record.medico).toBe('Doctor Test');
    expect(record.especialidad).toBe('Cirugía');
  });

  it('safe parses invalid runtime records and templates', () => {
    const invalidRecord = safeParseClinicalDocumentRecord({
      ...buildRecord(),
      patientName: 123,
    });
    const invalidTemplate = safeParseClinicalDocumentTemplate({
      ...CLINICAL_DOCUMENT_TEMPLATES.epicrisis,
      status: 'broken',
    });

    expect(invalidRecord.success).toBe(false);
    expect(invalidTemplate.success).toBe(false);
  });

  it('formats contract issues using root and nested paths', () => {
    expect(
      formatClinicalDocumentContractIssues([
        { path: [], message: 'General error' },
        { path: ['sections', 0, 'title'], message: 'Required' },
      ])
    ).toEqual(['root: General error', 'sections.0.title: Required']);
  });
});
