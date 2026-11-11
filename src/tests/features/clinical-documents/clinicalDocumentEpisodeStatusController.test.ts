import type { ClinicalDocumentsWorkspacePatientContract } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import { describe, expect, it } from 'vitest';

import {
  buildClinicalDocumentsReadOnlyMessage,
  canMutateClinicalDocumentsEpisode,
  resolveClinicalDocumentPersistReason,
  resolveClinicalDocumentsEpisodeClosure,
} from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeStatusController';

const buildPatient = (
  patch: Partial<ClinicalDocumentsWorkspacePatientContract> = {}
): ClinicalDocumentsWorkspacePatientContract => ({
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  admissionDate: '2026-03-06',
  ...patch,
});

describe('clinicalDocumentEpisodeStatusController', () => {
  it('detects episode closure from transfer metadata', () => {
    expect(
      resolveClinicalDocumentsEpisodeClosure(
        buildPatient({
          transferDate: '2026-03-08',
        })
      )
    ).toEqual({
      isClosed: true,
      closureKind: 'transfer',
      closureDate: '2026-03-08',
    });
  });

  it('blocks non-admin mutations on closed episodes', () => {
    const patient = buildPatient({
      dischargeDate: '2026-03-08',
    });

    expect(canMutateClinicalDocumentsEpisode(patient, 'doctor_specialist')).toBe(false);
    expect(canMutateClinicalDocumentsEpisode(patient, 'admin')).toBe(true);
  });

  it('builds a specific read-only message for closed episodes', () => {
    const patient = buildPatient({
      episodeClosureKind: 'transfer',
      episodeClosureDate: '2026-03-08',
    });

    expect(buildClinicalDocumentsReadOnlyMessage(patient, 'doctor_urgency', true)).toBe(
      'Episodio cerrado por traslado: solo ADMIN puede crear, editar o eliminar documentos.'
    );
  });

  it('marks admin edits on closed episodes as admin_fix', () => {
    const patient = buildPatient({
      dischargeDate: '2026-03-08',
    });

    expect(resolveClinicalDocumentPersistReason(patient, 'admin')).toBe('admin_fix');
    expect(resolveClinicalDocumentPersistReason(patient, 'doctor_urgency')).toBe('autosave');
  });
});
