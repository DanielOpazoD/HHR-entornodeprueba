// @vitest-environment node

/**
 * Tests for clinical document presence controller.
 *
 * Validates that document counts are correctly aggregated per
 * episode key and mapped to bed IDs for badge display.
 */

import { describe, it, expect } from 'vitest';
import {
  buildActiveClinicalDocumentEpisodeKeys,
  buildBedEpisodeBindings,
  buildClinicalDocumentPresenceByBed,
  buildClinicalDocumentPresenceProjection,
  buildClinicalDocumentPresenceInfoByBed,
  type BedEpisodeBinding,
} from '@/features/census/controllers/clinicalDocumentPresenceController';
import { BEDS } from '@/constants/beds';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { BedType } from '@/types/domain/beds';
import { DataFactory } from '@/tests/factories/DataFactory';

const bindings: BedEpisodeBinding[] = [
  {
    bedId: 'R1',
    episodeKey: 'episode-canonical-r1',
    episodeKeys: ['episode-canonical-r1', '12345678-9__2026-01-10'],
  },
  { bedId: 'R2', episodeKey: '98765432-1__2026-02-15' },
  { bedId: 'NEO1', episodeKey: '11111111-1__2026-03-01' },
];

const records = [
  { status: 'published', episodeKey: '12345678-9__2026-01-10' },
  { status: 'draft', episodeKey: '12345678-9__2026-01-10' },
  { status: 'published', episodeKey: '98765432-1__2026-02-15' },
  { status: 'archived', episodeKey: '12345678-9__2026-01-10' },
  { status: 'archived', episodeKey: '11111111-1__2026-03-01' },
];

describe('clinicalDocumentPresenceController', () => {
  describe('buildBedEpisodeBindings', () => {
    it('does not bind canonical patients to legacy episode keys from prior bed occupants', () => {
      const result = buildBedEpisodeBindings([
        {
          kind: 'occupied',
          id: 'row-r1',
          bed: { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
          data: DataFactory.createMockPatient('R1', {
            patientName: 'Paciente nuevo',
            rut: '11.111.111-1',
            admissionDate: '2026-03-06',
            admissionTime: '15:00',
            clinicalEpisodeId: 'ep_current_admission',
          }),
          isSubRow: false,
        },
      ]);

      expect(result).toEqual([
        {
          bedId: 'R1',
          currentPatientRut: '11.111.111-1',
          episodeKey: 'ep_current_admission',
          episodeKeys: ['ep_current_admission'],
        },
      ]);
    });
  });

  describe('buildActiveClinicalDocumentEpisodeKeys', () => {
    it('returns only episode keys with non-archived documents', () => {
      const keys = buildActiveClinicalDocumentEpisodeKeys(records);

      expect(keys.has('12345678-9__2026-01-10')).toBe(true);
      expect(keys.has('98765432-1__2026-02-15')).toBe(true);
      expect(keys.has('11111111-1__2026-03-01')).toBe(false);
    });

    it('returns empty set for undefined records', () => {
      expect(buildActiveClinicalDocumentEpisodeKeys(undefined).size).toBe(0);
    });

    it('returns empty set for empty array', () => {
      expect(buildActiveClinicalDocumentEpisodeKeys([]).size).toBe(0);
    });
  });

  describe('buildClinicalDocumentPresenceByBed', () => {
    it('maps bed IDs to boolean presence', () => {
      const activeKeys = buildActiveClinicalDocumentEpisodeKeys(records);
      const result = buildClinicalDocumentPresenceByBed(bindings, activeKeys);

      expect(result).toEqual({
        R1: true,
        R2: true,
        NEO1: false,
      });
    });

    it('does not show presence for documents that belong to another patient rut', () => {
      const contaminatedBindings: BedEpisodeBinding[] = [
        {
          bedId: 'R1',
          episodeKey: 'ep_stale_bed_episode',
          episodeKeys: ['ep_stale_bed_episode'],
          currentPatientRut: '14.161.042-2',
        },
      ];
      const contaminatedRecords = [
        {
          status: 'draft',
          episodeKey: 'ep_stale_bed_episode',
          patientRut: '17.444.506-0',
        },
      ];
      const activeKeys = buildActiveClinicalDocumentEpisodeKeys(contaminatedRecords);

      expect(
        buildClinicalDocumentPresenceByBed(contaminatedBindings, activeKeys, contaminatedRecords)
      ).toEqual({ R1: false });
    });
  });

  describe('buildClinicalDocumentPresenceInfoByBed', () => {
    it('counts total and draft documents per bed', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, records);

      expect(result.R1).toEqual({
        present: true,
        totalCount: 2,
        draftCount: 1,
      });
    });

    it('excludes mismatched-rut documents from presence counts', () => {
      const contaminatedBindings: BedEpisodeBinding[] = [
        {
          bedId: 'R1',
          episodeKey: 'ep_stale_bed_episode',
          episodeKeys: ['ep_stale_bed_episode'],
          currentPatientRut: '14.161.042-2',
        },
      ];
      const contaminatedRecords = [
        {
          status: 'draft',
          episodeKey: 'ep_stale_bed_episode',
          patientRut: '17.444.506-0',
        },
        {
          status: 'published',
          episodeKey: 'ep_stale_bed_episode',
          patientRut: '14.161.042-2',
        },
      ];

      expect(
        buildClinicalDocumentPresenceInfoByBed(contaminatedBindings, contaminatedRecords).R1
      ).toEqual({
        present: true,
        totalCount: 1,
        draftCount: 0,
      });
    });

    it('counts published documents correctly', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, records);

      expect(result.R2).toEqual({
        present: true,
        totalCount: 1,
        draftCount: 0,
      });
    });

    it('returns zero counts for beds with only archived documents', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, records);

      expect(result.NEO1).toEqual({
        present: false,
        totalCount: 0,
        draftCount: 0,
      });
    });

    it('handles undefined records', () => {
      const result = buildClinicalDocumentPresenceInfoByBed(bindings, undefined);

      expect(result.R1.totalCount).toBe(0);
      expect(result.R1.present).toBe(false);
    });

    it('handles empty bindings', () => {
      const result = buildClinicalDocumentPresenceInfoByBed([], records);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});

it('visits each document at most twice across 20 beds instead of rescanning the full collection', () => {
  let statusReads = 0;
  const beds = Array.from({ length: 20 }, (_, i) => ({ bedId: `B${i}`, episodeKey: `ep${i}` }));
  const documents = Array.from({ length: 300 }, (_, i) => ({
    episodeKey: `ep${i % 20}`,
    get status() {
      statusReads++;
      return 'draft';
    },
  }));
  const result = buildClinicalDocumentPresenceInfoByBed(beds, documents);
  expect(
    Object.values(result).every(info => info.totalCount === 15 && info.draftCount === 15)
  ).toBe(true);
  console.info('DOCUMENT_STATUS_VISITS', statusReads);
  expect(statusReads).toBeLessThanOrEqual(600);
});

it('preserves episode aliases, archived exclusion and patient identity in the combined projection', () => {
  const projection = buildClinicalDocumentPresenceProjection(
    [
      {
        bedId: 'R1',
        episodeKey: 'canonical',
        episodeKeys: ['canonical', 'legacy', 'legacy'],
        currentPatientRut: '12.345.678-K',
      },
      { bedId: 'R2', episodeKey: 'canonical', currentPatientRut: '9-0' },
      { bedId: 'R3', episodeKey: 'absent' },
    ],
    [
      { episodeKey: 'canonical', status: 'draft', patientRut: '12345678-k' },
      { episodeKey: 'legacy', status: 'published', patientRut: '12.345.678-K' },
      { episodeKey: 'canonical', status: 'archived', patientRut: '12.345.678-K' },
      { episodeKey: 'canonical', status: 'published', patientRut: '9-0' },
      { episodeKey: 'canonical', status: 'draft' },
      { episodeKey: 'unrelated', status: 'published', patientRut: '12.345.678-K' },
    ]
  );
  expect(projection).toEqual({
    byBedId: { R1: true, R2: true, R3: false },
    infoByBedId: {
      R1: { present: true, totalCount: 3, draftCount: 2 },
      R2: { present: true, totalCount: 2, draftCount: 1 },
      R3: { present: false, totalCount: 0, draftCount: 0 },
    },
  });
});

// Census rows and episode identity (formerly src/tests/views/census/clinicalDocumentPresenceController.test.ts).
describe('clinical document presence for census rows', () => {
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
