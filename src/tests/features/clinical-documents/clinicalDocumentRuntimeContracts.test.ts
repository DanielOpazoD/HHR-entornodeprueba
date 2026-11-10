import { describe, expect, it } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import {
  formatClinicalDocumentContractIssues,
  parseClinicalDocumentRecord,
  safeParseClinicalDocumentRecord,
} from '@/domain/clinical-documents/runtimeContracts';

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

  it('keeps print and IEEH choices through the repository contract', () => {
    // ClinicalDocumentRepository parses with the domain contract on save and on read.
    const record = parseClinicalDocumentRecord({
      ...buildRecord(),
      includePatientSignature: false,
      annexIncludedInPrint: true,
      ieehDraft: {
        cie10Code: 'A00',
        cie10Description: 'Cólera',
        diagnosticoPrincipal: 'Cólera',
        condicionEgreso: '1',
        intervencionQuirurgica: '2',
        procedimiento: '2',
        tratanteNombreCompleto: 'Pérez Soto Ana María',
        tratanteEspecialidad: 'Cirugía Adulto',
      },
    });

    expect(record.includePatientSignature).toBe(false);
    expect(record.annexIncludedInPrint).toBe(true);
    expect(record.ieehDraft?.tratanteNombreCompleto).toBe('Pérez Soto Ana María');
    expect(record.ieehDraft?.tratanteEspecialidad).toBe('Cirugía Adulto');
  });

  it('safe parses invalid runtime records', () => {
    const invalidRecord = safeParseClinicalDocumentRecord({
      ...buildRecord(),
      patientName: 123,
    });

    expect(invalidRecord.success).toBe(false);
  });

  it('formats contract issues using root, nested and symbol paths', () => {
    expect(
      formatClinicalDocumentContractIssues([
        { path: [], message: 'General error' },
        { path: ['sections', 0, 'title'], message: 'Required' },
        { path: [Symbol('field')], message: 'Invalid key' },
      ])
    ).toEqual(['root: General error', 'sections.0.title: Required', 'Symbol(field): Invalid key']);
  });
});

describe('section persistence contract', () => {
  it.each(['structured', 'unified'])('preserves %s layout through record parsing', layout => {
    const sections = [
      {
        id: 'standard-section',
        title: 'Section title',
        content: '<p>Section content</p>',
        kind: 'standard',
        layout,
        updateDate: '2026-03-06',
        updateTime: '10:30',
        order: 0,
        required: false,
        visible: false,
      },
      {
        id: 'clinical-update-section',
        title: 'Update title',
        content: '',
        kind: 'clinical-update',
        layout,
        order: 1,
        required: true,
        visible: true,
      },
      { id: 'legacy-kind-section', title: 'Legacy title', content: '', layout, order: 2 },
    ];
    const parsed = parseClinicalDocumentRecord({ ...buildRecord(), sections });

    expect(parseClinicalDocumentRecord(JSON.parse(JSON.stringify(parsed))).sections).toStrictEqual(
      sections
    );
  });

  it('accepts legacy sections without adding a layout default', () => {
    const sections = [{ id: 'legacy-section', title: 'Legacy title', content: '', order: 0 }];

    expect(parseClinicalDocumentRecord({ ...buildRecord(), sections }).sections).toStrictEqual(
      sections
    );
  });

  it('rejects an invalid layout at the section boundary', () => {
    const result = safeParseClinicalDocumentRecord({
      ...buildRecord(),
      sections: [{ id: 'section', title: 'Title', content: '', order: 0, layout: 'compact' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['sections', 0, 'layout'] }),
      ]);
    }
  });
});
