import { describe, expect, it } from 'vitest';

import {
  buildClinicalDocumentVersionSectionSnapshots,
  resolveClinicalDocumentVersionChangedSectionIds,
  withCurrentClinicalDocumentVersionSnapshotFallback,
} from '@/domain/clinical-documents/versionHistory';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentVersionMeta,
} from '@/domain/clinical-documents/entities';

const actor = {
  uid: 'u1',
  email: 'doc@test.cl',
  displayName: 'Doctor Test',
  role: 'doctor_urgency',
};

const buildRecord = (contentBySection: Record<string, string>): ClinicalDocumentRecord =>
  ({
    id: 'doc-1',
    hospitalId: 'hhr',
    documentType: 'epicrisis',
    templateId: 'epicrisis',
    templateVersion: 1,
    title: 'Epicrisis',
    patientInfoTitle: 'Información del Paciente',
    footerMedicoLabel: 'Médico',
    footerEspecialidadLabel: 'Especialidad',
    patientRut: '11.111.111-1',
    patientName: 'Paciente Test',
    episodeKey: 'episode-1',
    patientFields: [],
    sections: [
      {
        id: 'evolucion',
        title: 'Evolución clínica',
        content: contentBySection.evolucion || '',
        order: 2,
      },
      {
        id: 'diagnosticos',
        title: 'Diagnósticos',
        content: contentBySection.diagnosticos || '',
        order: 1,
      },
    ],
    medico: 'Doctor Test',
    especialidad: 'Medicina',
    status: 'draft',
    isLocked: false,
    isActiveEpisodeDocument: true,
    currentVersion: 1,
    versionHistory: [],
    audit: {
      createdAt: '2026-04-24T10:00:00.000Z',
      createdBy: actor,
      updatedAt: '2026-04-24T10:00:00.000Z',
      updatedBy: actor,
    },
  }) as ClinicalDocumentRecord;

describe('clinicalDocumentVersionHistoryController', () => {
  it('builds ordered section snapshots for version history previews', () => {
    const snapshots = buildClinicalDocumentVersionSectionSnapshots(
      buildRecord({ evolucion: 'Evolución actual', diagnosticos: 'Dx actual' })
    );

    expect(snapshots).toEqual([
      {
        sectionId: 'diagnosticos',
        title: 'Diagnósticos',
        content: 'Dx actual',
        order: 1,
        kind: undefined,
      },
      {
        sectionId: 'evolucion',
        title: 'Evolución clínica',
        content: 'Evolución actual',
        order: 2,
        kind: undefined,
      },
    ]);
  });

  it('resolves changed sections against the previous version snapshot', () => {
    const previousVersion: ClinicalDocumentVersionMeta = {
      version: 1,
      savedAt: '2026-04-24T10:00:00.000Z',
      savedBy: actor,
      reason: 'manual',
      sectionSnapshots: buildClinicalDocumentVersionSectionSnapshots(
        buildRecord({ evolucion: 'Evolución previa', diagnosticos: 'Dx actual' })
      ),
    };

    const changed = resolveClinicalDocumentVersionChangedSectionIds(
      buildRecord({ evolucion: 'Evolución actualizada', diagnosticos: 'Dx actual' }),
      previousVersion
    );

    expect(changed).toEqual(['evolucion']);
  });

  it('does not mark every section as changed when the previous version has no comparable snapshot', () => {
    const previousVersion: ClinicalDocumentVersionMeta = {
      version: 1,
      savedAt: '2026-04-24T10:00:00.000Z',
      savedBy: actor,
      reason: 'autosave',
    };

    const changed = resolveClinicalDocumentVersionChangedSectionIds(
      buildRecord({ evolucion: 'Sin cambios reales', diagnosticos: 'Dx actual' }),
      previousVersion
    );

    expect(changed).toEqual([]);
  });

  it('fills the current version preview from the live document when persisted snapshots are missing', () => {
    const record = {
      ...buildRecord({ evolucion: 'Evolución visible', diagnosticos: 'Dx visible' }),
      currentVersion: 2,
      versionHistory: [
        {
          version: 2,
          savedAt: '2026-04-25T09:40:00.000Z',
          savedBy: actor,
          reason: 'autosave' as const,
        },
        {
          version: 1,
          savedAt: '2026-04-25T09:39:00.000Z',
          savedBy: actor,
          reason: 'manual' as const,
        },
      ],
    };

    const versions = withCurrentClinicalDocumentVersionSnapshotFallback(record);

    expect(versions[0]?.sectionSnapshots).toEqual(
      buildClinicalDocumentVersionSectionSnapshots(record)
    );
    expect(versions[0]?.changedSectionIds).toEqual([]);
    expect(versions[1]?.sectionSnapshots).toBeUndefined();
  });
});
