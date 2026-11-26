// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { executePersistClinicalDocumentDraft } from '@/application/clinical-documents/clinicalDocumentUseCases';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentPort } from '@/application/ports/clinicalDocumentPort';

const actor = {
  uid: 'u1',
  email: 'doc@test.cl',
  displayName: 'Doctor Test',
  role: 'doctor_urgency',
};

const buildDraft = () => {
  const draft = createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor,
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: 'episode-1',
      admissionDate: '2026-04-24',
      sourceDailyRecordDate: '2026-04-24',
      sourceBedId: 'R1',
      specialty: 'Medicina',
    },
    patientFieldValues: {},
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  });

  return {
    ...draft,
    currentVersion: 1,
    versionHistory: [
      {
        version: 1,
        savedAt: '2026-04-24T10:00:00.000Z',
        savedBy: actor,
        reason: 'manual' as const,
        sectionSnapshots: draft.sections.map(section => ({
          sectionId: section.id,
          title: section.title,
          content: section.content,
          order: section.order,
          kind: section.kind,
        })),
      },
    ],
    sections: draft.sections.map(section =>
      section.id === 'historia-evolucion'
        ? { ...section, content: 'Evolución actualizada.' }
        : section
    ),
  };
};

describe('clinicalDocumentUseCases', () => {
  it('persists version metadata with changed section ids and section snapshots', async () => {
    const saveDraft = vi.fn(async record => record);
    const port = {
      saveDraft,
    } as unknown as ClinicalDocumentPort;

    const result = await executePersistClinicalDocumentDraft(buildDraft(), 'hhr', actor, 'manual', {
      clinicalDocumentPort: port,
    });

    expect(result.status).toBe('success');
    const savedRecord = saveDraft.mock.calls[0]?.[0];
    const latestVersion = savedRecord.versionHistory.at(-1);
    expect(latestVersion).toMatchObject({
      version: 2,
      reason: 'manual',
      changedSectionIds: ['historia-evolucion'],
    });
    expect(latestVersion?.sectionSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionId: 'historia-evolucion',
          title: expect.any(String),
          content: 'Evolución actualizada.',
        }),
      ])
    );
  });
});
