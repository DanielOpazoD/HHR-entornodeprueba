import { describe, expect, it } from 'vitest';

import {
  resolveClinicalDocumentExceptionMessage,
  resolveClinicalDocumentOutcomeError,
  shouldClearSelectedClinicalDocument,
  updateClinicalDocumentPdfFailure,
  updateClinicalDocumentPdfSuccess,
} from '@/features/clinical-documents/hooks/clinicalDocumentWorkspaceActionSupport';
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

describe('clinicalDocumentWorkspaceActionSupport', () => {
  it('resolves outcome error preferring user-safe messages', () => {
    expect(
      resolveClinicalDocumentOutcomeError(
        {
          status: 'failed',
          data: null,
          userSafeMessage: 'Mensaje seguro.',
          issues: [{ kind: 'unknown', message: 'raw failure' }],
        },
        'fallback'
      )
    ).toBe('Mensaje seguro.');
  });

  it('resolves thrown exception messages with fallback for unknown values', () => {
    expect(resolveClinicalDocumentExceptionMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(resolveClinicalDocumentExceptionMessage('raw', 'fallback')).toBe('fallback');
  });

  it('updates PDF state for success and failure without mutating null state', () => {
    const record = buildRecord();

    expect(updateClinicalDocumentPdfFailure(null, 'error', record)).toBeNull();
    expect(updateClinicalDocumentPdfSuccess(null, { exportStatus: 'exported' }, record)).toBeNull();

    const failed = updateClinicalDocumentPdfFailure(record, 'drive down', record);
    expect(failed?.pdf?.exportStatus).toBe('failed');
    expect(failed?.pdf?.exportError).toBe('drive down');

    const succeeded = updateClinicalDocumentPdfSuccess(
      record,
      {
        exportStatus: 'exported',
        fileId: 'pdf-1',
      },
      record
    );
    expect(succeeded?.pdf).toEqual({
      exportStatus: 'exported',
      fileId: 'pdf-1',
    });
  });

  it('detects when deleting the active document should clear workspace selection', () => {
    expect(shouldClearSelectedClinicalDocument('doc-1', 'doc-1')).toBe(true);
    expect(shouldClearSelectedClinicalDocument('doc-1', 'doc-2')).toBe(false);
    expect(shouldClearSelectedClinicalDocument(null, 'doc-1')).toBe(false);
  });
});
