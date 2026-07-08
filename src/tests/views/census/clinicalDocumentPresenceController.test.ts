import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants/beds';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import {
  buildActiveClinicalDocumentEpisodeKeys,
  buildBedEpisodeBindings,
  buildClinicalDocumentPresenceByBed,
  buildClinicalDocumentPresenceInfoByBed,
} from '@/features/census/controllers/clinicalDocumentPresenceController';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('clinicalDocumentPresenceController', () => {
  it('builds episode bindings only for main occupied rows with rut and admission date', () => {
    const unifiedRows: UnifiedBedRow[] = [
      {
        kind: 'occupied',
        id: 'R1-main',
        bed: BEDS.find(bed => bed.id === 'R1')!,
        data: DataFactory.createMockPatient('R1', {
          patientName: 'Main',
          clinicalEpisodeId: 'episode-canonical-r1',
          rut: '11.111.111-1',
          admissionDate: '2026-03-05',
          admissionTime: '08:30',
        }),
        isSubRow: false,
      },
      {
        kind: 'occupied',
        id: 'R1-crib',
        bed: BEDS.find(bed => bed.id === 'R1')!,
        data: DataFactory.createMockPatient('R1-crib', {
          patientName: 'Baby',
          rut: '22.222.222-2',
          admissionDate: '2026-03-05',
        }),
        isSubRow: true,
      },
      {
        kind: 'occupied',
        id: 'R2-main',
        bed: BEDS.find(bed => bed.id === 'R2')!,
        data: DataFactory.createMockPatient('R2', {
          patientName: 'No rut',
          rut: '',
          admissionDate: '2026-03-05',
        }),
        isSubRow: false,
      },
    ];

    expect(buildBedEpisodeBindings(unifiedRows)).toEqual([
      {
        bedId: 'R1',
        episodeKey: 'episode-canonical-r1',
        currentPatientRut: '11.111.111-1',
        episodeKeys: [
          'episode-canonical-r1',
          '11.111.111-1__2026-03-05__08:30',
          '11111111-1__2026-03-05__08:30',
          '11.111.111-1__2026-03-05',
          '11111111-1__2026-03-05',
        ],
      },
    ]);
  });

  it('builds active episode set and presence map excluding archived documents', () => {
    const baseDocument: ClinicalDocumentRecord = {
      id: 'doc-base',
      hospitalId: 'h1',
      documentType: 'epicrisis',
      templateId: 'epicrisis',
      templateVersion: 1,
      title: 'Epicrisis',
      patientInfoTitle: 'Informacion del Paciente',
      footerMedicoLabel: 'Medico',
      footerEspecialidadLabel: 'Especialidad',
      patientRut: '11.111.111-1',
      patientName: 'Paciente',
      episodeKey: '11.111.111-1__2026-03-05',
      admissionDate: '2026-03-05',
      patientFields: [],
      sections: [],
      medico: 'Dr Test',
      especialidad: 'Medicina',
      status: 'draft',
      isLocked: false,
      isActiveEpisodeDocument: true,
      currentVersion: 1,
      versionHistory: [],
      audit: {
        createdAt: '2026-03-05T00:00:00.000Z',
        createdBy: {
          uid: 'u1',
          email: 'test@example.com',
          displayName: 'Test',
          role: 'admin',
        },
        updatedAt: '2026-03-05T00:00:00.000Z',
        updatedBy: {
          uid: 'u1',
          email: 'test@example.com',
          displayName: 'Test',
          role: 'admin',
        },
      },
    };

    const documents: ClinicalDocumentRecord[] = [
      {
        ...baseDocument,
        id: 'doc-1',
        episodeKey: '11.111.111-1__2026-03-05',
        status: 'draft',
      },
      {
        ...baseDocument,
        id: 'doc-2',
        patientRut: '22.222.222-2',
        episodeKey: '22.222.222-2__2026-03-05',
        status: 'archived',
      },
    ];

    const activeEpisodeKeys = buildActiveClinicalDocumentEpisodeKeys(documents);

    expect(
      buildClinicalDocumentPresenceByBed(
        [
          { bedId: 'R1', episodeKey: '11.111.111-1__2026-03-05' },
          {
            bedId: 'R2',
            episodeKey: 'episode-canonical-r2',
            episodeKeys: ['episode-canonical-r2', '22.222.222-2__2026-03-05'],
          },
        ],
        activeEpisodeKeys
      )
    ).toEqual({
      R1: true,
      R2: false,
    });
  });

  it('keeps document presence when the same episode moves to a different bed', () => {
    const bindings = [
      {
        bedId: 'R3',
        episodeKey: 'ep_shared_hospitalization',
        episodeKeys: ['ep_shared_hospitalization'],
        currentPatientRut: '11.111.111-1',
      },
    ];
    const documents = [
      {
        status: 'draft',
        episodeKey: 'ep_shared_hospitalization',
        patientRut: '11.111.111-1',
      },
    ];

    expect(
      buildClinicalDocumentPresenceByBed(
        bindings,
        buildActiveClinicalDocumentEpisodeKeys(documents),
        documents
      )
    ).toEqual({ R3: true });
    expect(buildClinicalDocumentPresenceInfoByBed(bindings, documents)).toEqual({
      R3: {
        present: true,
        totalCount: 1,
        draftCount: 1,
      },
    });
  });

  it('does not show previous same-day admission documents when the current episode has a canonical id', () => {
    const bindings = [
      {
        bedId: 'R4',
        episodeKey: 'ep_afternoon_readmission',
        episodeKeys: ['ep_afternoon_readmission'],
        currentPatientRut: '11.111.111-1',
      },
    ];
    const documents = [
      {
        status: 'draft',
        episodeKey: '11.111.111-1__2026-03-05__08:00',
        patientRut: '11.111.111-1',
      },
      {
        status: 'draft',
        episodeKey: '11.111.111-1__2026-03-05',
        patientRut: '11.111.111-1',
      },
    ];

    expect(
      buildClinicalDocumentPresenceByBed(
        bindings,
        buildActiveClinicalDocumentEpisodeKeys(documents),
        documents
      )
    ).toEqual({ R4: false });
    expect(buildClinicalDocumentPresenceInfoByBed(bindings, documents)).toEqual({
      R4: {
        present: false,
        totalCount: 0,
        draftCount: 0,
      },
    });
  });

  it('does not count documents from another patient even if a legacy episode key collides', () => {
    const bindings = [
      {
        bedId: 'R1',
        episodeKey: '11.111.111-1__2026-03-05',
        episodeKeys: ['11.111.111-1__2026-03-05'],
        currentPatientRut: '11.111.111-1',
      },
    ];
    const documents = [
      {
        status: 'draft',
        episodeKey: '11.111.111-1__2026-03-05',
        patientRut: '22.222.222-2',
      },
    ];

    expect(
      buildClinicalDocumentPresenceByBed(
        bindings,
        buildActiveClinicalDocumentEpisodeKeys(documents),
        documents
      )
    ).toEqual({ R1: false });
    expect(buildClinicalDocumentPresenceInfoByBed(bindings, documents)).toEqual({
      R1: {
        present: false,
        totalCount: 0,
        draftCount: 0,
      },
    });
  });
});
