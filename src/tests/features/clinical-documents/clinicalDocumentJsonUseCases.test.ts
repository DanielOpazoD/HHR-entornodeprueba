import { describe, expect, it } from 'vitest';

import {
  CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA,
  buildClinicalDocumentJsonExport,
  buildClinicalDocumentJsonFileName,
  prepareClinicalDocumentJsonImportDraft,
} from '@/application/clinical-documents/clinicalDocumentJsonUseCases';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentAuditActor } from '@/domain/clinical-documents/entities';

const actor: ClinicalDocumentAuditActor = {
  uid: 'u1',
  email: 'doctor@test.com',
  displayName: 'Doctor Test',
  role: 'doctor_urgency',
};

const buildDocument = () =>
  createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor,
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

describe('clinicalDocumentJsonUseCases', () => {
  it('exports a selected clinical document with an explicit schema contract', () => {
    const document = buildDocument();

    const result = buildClinicalDocumentJsonExport(document, '2026-04-24T10:00:00.000Z');

    expect(result.schema).toBe(CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA);
    expect(result.exportedAt).toBe('2026-04-24T10:00:00.000Z');
    expect(result.document).toEqual(document);
  });

  it('builds a readable json filename without unsafe path characters', () => {
    const document = {
      ...buildDocument(),
      patientName: 'Paciente / Test',
      title: 'Epicrisis: ingreso',
    };

    expect(buildClinicalDocumentJsonFileName(document)).toBe(
      'documento-clinico-2026-03-06-paciente-test-epicrisis-ingreso.json'
    );
  });

  it('imports a json export as a new draft copy instead of reusing the source id', () => {
    const source = {
      ...buildDocument(),
      status: 'signed' as const,
      isLocked: true,
      pdf: { exportStatus: 'exported' as const, fileId: 'drive-file-id' },
    };
    const payload = JSON.stringify(buildClinicalDocumentJsonExport(source));

    const result = prepareClinicalDocumentJsonImportDraft(payload, actor);

    expect(result.status).toBe('success');
    expect(result.data).toEqual(
      expect.objectContaining({
        hospitalId: 'hhr',
        patientRut: source.patientRut,
        status: 'draft',
        isLocked: false,
        currentVersion: 1,
        pdf: undefined,
      })
    );
    expect(result.data?.id).not.toBe(source.id);
    expect(result.data?.title).toMatch(/\(importado\)$/i);
    expect(result.data?.versionHistory).toHaveLength(1);
    expect(result.data?.versionHistory[0]?.reason).toBe('manual');
  });

  it('rejects invalid json payloads before persistence', () => {
    const result = prepareClinicalDocumentJsonImportDraft(
      JSON.stringify({ schema: 'wrong.schema', document: buildDocument() }),
      actor
    );

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.kind).toBe('validation');
  });

  it('rejects schema-compatible payloads that do not contain a valid clinical document', () => {
    const result = prepareClinicalDocumentJsonImportDraft(
      JSON.stringify({ schema: CLINICAL_DOCUMENT_JSON_EXPORT_SCHEMA, document: { id: 'broken' } }),
      actor
    );

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.kind).toBe('validation');
  });
});
