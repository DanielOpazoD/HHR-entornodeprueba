// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createClinicalDocumentDraft,
  duplicateClinicalDocumentDraft,
} from '@/features/clinical-documents/domain/factories';

const actor = {
  uid: 'u1',
  email: 'doctor@test.com',
  displayName: 'Doctor Test',
  role: 'doctor_urgency',
};

const buildDraft = () =>
  createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor,
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: 'episode-1',
      admissionDate: '2026-04-25',
      sourceDailyRecordDate: '2026-04-25',
      sourceBedId: 'R1',
      specialty: 'Medicina',
    },
    patientFieldValues: {},
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  });

describe('clinical document factories', () => {
  it('stores section snapshots on the initial version of a new draft', () => {
    const draft = buildDraft();
    const initialVersion = draft.versionHistory[0];

    expect(initialVersion?.changedSectionIds).toEqual(draft.sections.map(section => section.id));
    expect(initialVersion?.sectionSnapshots).toEqual(
      draft.sections
        .slice()
        .sort((left, right) => left.order - right.order)
        .map(section =>
          expect.objectContaining({
            sectionId: section.id,
            title: section.title,
            content: section.content,
          })
        )
    );
  });

  it('stores section snapshots on the initial version of a duplicated draft', () => {
    const duplicated = duplicateClinicalDocumentDraft(buildDraft(), actor);
    const initialVersion = duplicated.versionHistory[0];

    expect(initialVersion?.changedSectionIds).toEqual(
      duplicated.sections.map(section => section.id)
    );
    expect(initialVersion?.sectionSnapshots).toHaveLength(duplicated.sections.length);
  });
});
