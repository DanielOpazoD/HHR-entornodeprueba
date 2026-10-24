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
import {
  formatClinicalDocumentContractIssues as formatDomainClinicalDocumentContractIssues,
  parseClinicalDocumentRecord as parseDomainClinicalDocumentRecord,
  safeParseClinicalDocumentRecord as safeParseDomainClinicalDocumentRecord,
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

  it.each([
    { name: 'domain', format: formatDomainClinicalDocumentContractIssues },
    { name: 'feature', format: formatClinicalDocumentContractIssues },
  ])('formats $name contract issues using root, nested and symbol paths', ({ format }) => {
    expect(
      format([
        { path: [], message: 'General error' },
        { path: ['sections', 0, 'title'], message: 'Required' },
        { path: [Symbol('field')], message: 'Invalid key' },
      ])
    ).toEqual(['root: General error', 'sections.0.title: Required', 'Symbol(field): Invalid key']);
  });
});

describe.each([
  {
    name: 'domain',
    parse: parseDomainClinicalDocumentRecord,
    safeParse: safeParseDomainClinicalDocumentRecord,
  },
  {
    name: 'feature',
    parse: parseClinicalDocumentRecord,
    safeParse: safeParseClinicalDocumentRecord,
  },
])('$name section persistence contract', ({ parse, safeParse }) => {
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
    const parsed = parse({ ...buildRecord(), sections });

    expect(parse(JSON.parse(JSON.stringify(parsed))).sections).toStrictEqual(sections);
  });

  it('accepts legacy sections without adding a layout default', () => {
    const sections = [{ id: 'legacy-section', title: 'Legacy title', content: '', order: 0 }];

    expect(parse({ ...buildRecord(), sections }).sections).toStrictEqual(sections);
  });

  it('rejects an invalid layout at the section boundary', () => {
    const result = safeParse({
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
