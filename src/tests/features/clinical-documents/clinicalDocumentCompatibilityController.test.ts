import { describe, expect, it } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { hydrateLegacyClinicalDocument } from '@/features/clinical-documents/controllers/clinicalDocumentCompatibilityController';

const buildDocument = () =>
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

describe('clinicalDocumentCompatibilityController', () => {
  it('hydrates empty section titles with a safe fallback title', () => {
    const document = buildDocument();
    document.sections = document.sections.map((section, index) =>
      index === 0 ? { ...section, title: '   ' } : section
    );

    const hydrated = hydrateLegacyClinicalDocument(document);

    expect(hydrated.sections[0]?.title).toBe('Sección 1');
  });

  it('hydrates evolucion documents with diagnosticos actuales after historia y evolución clínica', () => {
    const document = createClinicalDocumentDraft({
      templateId: 'evolucion',
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
    document.sections = document.sections.filter(section => section.id !== 'diagnosticos');

    const hydrated = hydrateLegacyClinicalDocument(document);

    expect(hydrated.sections.map(section => section.id)).toEqual([
      'antecedentes',
      'historia-evolucion',
      'diagnosticos',
      'plan',
    ]);
    expect(hydrated.sections[2]?.title).toBe('Diagnósticos actuales');
  });

  it('defaults legacy annex print inclusion to true', () => {
    const document = buildDocument();
    document.annexContent = '<p>Anexo</p>';
    delete document.annexIncludedInPrint;

    const hydrated = hydrateLegacyClinicalDocument(document);

    expect(hydrated.annexIncludedInPrint).toBe(true);
  });

  it('defaults legacy patient signature inclusion to true', () => {
    const document = buildDocument();
    delete document.includePatientSignature;

    const hydrated = hydrateLegacyClinicalDocument(document);

    expect(hydrated.includePatientSignature).toBe(true);
  });

  it('preserves episode-close locks while clearing retired bare locks', () => {
    const closedEpisodeDocument = {
      ...buildDocument(),
      isLocked: true,
      lockedReason: 'episode_closed' as const,
      lockedAt: '2026-03-06T12:00:00.000Z',
    };
    const retiredSignatureLockDocument = {
      ...buildDocument(),
      isLocked: true,
    };

    expect(hydrateLegacyClinicalDocument(closedEpisodeDocument)).toMatchObject({
      isLocked: true,
      lockedReason: 'episode_closed',
      lockedAt: '2026-03-06T12:00:00.000Z',
    });
    expect(hydrateLegacyClinicalDocument(retiredSignatureLockDocument).isLocked).toBe(false);
  });

  it('hydrates incomplete legacy audit actors for workspace compatibility', () => {
    const legacyActor = {
      uid: 'legacy-user',
      email: 'legacy@hospital.cl',
    };
    const document = {
      ...buildDocument(),
      audit: {
        createdAt: '2026-03-06T10:00:00.000Z',
        createdBy: legacyActor,
        updatedAt: '2026-03-06T11:00:00.000Z',
        updatedBy: legacyActor,
        signatureRevocations: [
          {
            revokedAt: '2026-03-06T12:00:00.000Z',
            revokedBy: legacyActor,
            reason: 'Corrección legacy',
          },
        ],
      },
      versionHistory: [
        {
          version: 1,
          savedAt: '2026-03-06T10:30:00.000Z',
          savedBy: legacyActor,
          reason: 'manual' as const,
        },
      ],
    } as unknown as ReturnType<typeof buildDocument>;

    const hydrated = hydrateLegacyClinicalDocument(document);

    expect(hydrated.audit.createdBy).toMatchObject({
      uid: 'legacy-user',
      email: 'legacy@hospital.cl',
      displayName: 'Usuario legado',
      role: 'legacy_unknown',
    });
    expect(hydrated.audit.updatedBy).toMatchObject({
      displayName: 'Usuario legado',
      role: 'legacy_unknown',
    });
    expect(hydrated.audit.signatureRevocations?.[0]?.revokedBy).toMatchObject({
      displayName: 'Usuario legado',
      role: 'legacy_unknown',
    });
    expect(hydrated.versionHistory[0]?.savedBy).toMatchObject({
      displayName: 'Usuario legado',
      role: 'legacy_unknown',
    });
  });
});
