// @vitest-environment node

/**
 * Tests for clinical document presence controller.
 *
 * Validates that document counts are correctly aggregated per
 * episode key and mapped to bed IDs for badge display.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBedEpisodeBindings,
  countActiveClinicalDocumentsByBed,
  type BedEpisodeBinding,
} from '@/features/census/controllers/clinicalDocumentPresenceController';
import { BEDS } from '@/constants/beds';
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
  {
    bedId: 'NEO1',
    episodeKey: 'canonical-neo',
    episodeKeys: ['canonical-neo', '11111111-1__2026-03-01'],
  },
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

  it('counts drafts and published documents for the episode and excludes archives', () => {
    expect(countActiveClinicalDocumentsByBed(bindings, records)).toEqual({ R1: 2, R2: 1, NEO1: 0 });
  });

  it('returns zero per bound bed after a successful empty read', () => {
    expect(countActiveClinicalDocumentsByBed(bindings, [])).toEqual({ R1: 0, R2: 0, NEO1: 0 });
    expect(countActiveClinicalDocumentsByBed([], records)).toEqual({});
  });
});

it('checks the status of each document at most once across 20 beds', () => {
  let statusReads = 0;
  const beds = Array.from({ length: 20 }, (_, i) => ({ bedId: `B${i}`, episodeKey: `ep${i}` }));
  const documents = Array.from({ length: 300 }, (_, i) => ({
    episodeKey: `ep${i % 20}`,
    get status() {
      statusReads++;
      return 'draft';
    },
  }));
  const counts = countActiveClinicalDocumentsByBed(beds, documents);
  expect(Object.values(counts)).toEqual(Array(20).fill(15));
  console.info('DOCUMENT_STATUS_VISITS', statusReads);
  expect(statusReads).toBeLessThanOrEqual(documents.length);
});

it('preserves episode aliases, archived exclusion and patient identity in the document counts', () => {
  const counts = countActiveClinicalDocumentsByBed(
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
  expect(counts).toEqual({ R1: 3, R2: 2, R3: 0 });
});

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

    expect(countActiveClinicalDocumentsByBed(bindings, documents)).toEqual({ R3: 1 });
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

    expect(countActiveClinicalDocumentsByBed(bindings, documents)).toEqual({ R4: 0 });
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

    expect(countActiveClinicalDocumentsByBed(bindings, documents)).toEqual({ R1: 0 });
  });
});
