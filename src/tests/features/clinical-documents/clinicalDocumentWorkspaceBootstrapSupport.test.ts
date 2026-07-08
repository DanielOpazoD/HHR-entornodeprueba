import { describe, expect, it } from 'vitest';

import {
  filterClinicalDocumentsForCurrentEpisode,
  resolveNextSelectedClinicalDocumentId,
  resolveSelectedClinicalTemplateId,
  shouldSeedClinicalDocumentTemplates,
} from '@/features/clinical-documents/hooks/clinicalDocumentWorkspaceBootstrapSupport';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

const buildDocument = (id: string) => ({
  ...createClinicalDocumentDraft({
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
  }),
  id,
});

describe('clinicalDocumentWorkspaceBootstrapSupport', () => {
  it('resolves selected template with safe fallback', () => {
    expect(
      resolveSelectedClinicalTemplateId(
        [
          {
            id: 'epicrisis',
            name: 'Epicrisis',
            title: 'Epicrisis',
            version: 1,
            patientFields: [],
            sections: [],
            allowCustomTitle: false,
            allowAddSection: false,
            allowClinicalUpdateSections: false,
            status: 'active',
            documentType: 'epicrisis',
            defaultPatientInfoTitle: 'Paciente',
            defaultFooterMedicoLabel: 'Médico',
            defaultFooterEspecialidadLabel: 'Especialidad',
          },
        ],
        'missing'
      )
    ).toBe('epicrisis');
  });

  it('detects when template seeding should run for admin bootstrap', () => {
    expect(
      shouldSeedClinicalDocumentTemplates({
        isActive: true,
        role: 'admin',
        hasLoadedRemoteTemplates: true,
        remoteTemplateCount: 0,
      })
    ).toBe(true);
    expect(
      shouldSeedClinicalDocumentTemplates({
        isActive: true,
        role: 'doctor_urgency',
        hasLoadedRemoteTemplates: true,
        remoteTemplateCount: 0,
      })
    ).toBe(false);
  });

  it('keeps selection when still present and falls back to first document otherwise', () => {
    const primary = buildDocument('primary');
    const secondary = buildDocument('secondary');

    expect(resolveNextSelectedClinicalDocumentId([primary, secondary], null)).toBe('primary');
    expect(resolveNextSelectedClinicalDocumentId([primary, secondary], 'secondary')).toBe(
      'secondary'
    );
    expect(resolveNextSelectedClinicalDocumentId([primary], 'missing')).toBe('primary');
    expect(resolveNextSelectedClinicalDocumentId([], 'missing')).toBeNull();
  });

  it('rejects documents from another patient even when a stale episode key matches the bed', () => {
    const oldPatientDocument = {
      ...buildDocument('old-patient-doc'),
      episodeKey: 'ep_stale_bed_episode',
      patientRut: '17.444.506-0',
      patientName: 'Carla Walker Rapu',
    };
    const currentPatientDocument = {
      ...buildDocument('current-patient-doc'),
      episodeKey: 'ep_stale_bed_episode',
      patientRut: '14.161.042-2',
      patientName: 'Rodrigo Valenzuela Navarro',
    };

    expect(
      filterClinicalDocumentsForCurrentEpisode({
        documents: [oldPatientDocument, currentPatientDocument],
        currentEpisodeKey: 'ep_stale_bed_episode',
        allowedEpisodeKeys: ['ep_stale_bed_episode'],
        currentPatientRut: '14.161.042-2',
      }).map(document => document.id)
    ).toEqual(['current-patient-doc']);
  });
});
