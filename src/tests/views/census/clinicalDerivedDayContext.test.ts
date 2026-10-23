import { describe, expect, it } from 'vitest';
import { collectDuplicateActiveEpisodeIds } from '@/features/census/components/patient-row/clinicalDerivedDayContext';
import { collectClinicalDerivedEpisodes } from '@/services/storage/clinicalDerivedContract';

// The census table counts holders without loading the overlay; both must agree on which ids the
// overlay leaves embedded (D4). Synthetic beds only.
const cases: Array<[string, Record<string, unknown>]> = [
  [
    'mother and newborn are distinct episodes',
    { R1: { clinicalEpisodeId: 'ep_mother', clinicalCrib: { clinicalEpisodeId: 'ep_newborn' } } },
  ],
  [
    'a crib that repeats its mother id',
    { R1: { clinicalEpisodeId: 'ep_same', clinicalCrib: { clinicalEpisodeId: 'ep_same' } } },
  ],
  [
    'a newborn in its own bed and still in the crib',
    {
      R1: { clinicalEpisodeId: 'ep_mother', clinicalCrib: { clinicalEpisodeId: 'ep_newborn' } },
      R2: { clinicalEpisodeId: 'ep_newborn' },
    },
  ],
  [
    'a blocked bed that keeps an old id',
    { R1: { clinicalEpisodeId: 'ep_a' }, R2: { clinicalEpisodeId: 'ep_a', isBlocked: true } },
  ],
  [
    'ids that only differ by surrounding spaces',
    { R1: { clinicalEpisodeId: ' ep_a' }, R2: { clinicalEpisodeId: 'ep_a ' } },
  ],
  [
    'invalid document ids are still counted',
    { R1: { clinicalEpisodeId: 'ep/a' }, R2: { clinicalEpisodeId: 'ep/a' } },
  ],
  [
    'empty, missing and non-string ids',
    {
      R1: { clinicalEpisodeId: '' },
      R2: { clinicalEpisodeId: '' },
      R3: { clinicalEpisodeId: 7 },
      R4: null,
      R5: {},
    },
  ],
];

describe('clinicalDerived day context (D4 duplicates)', () => {
  it.each(cases)('agrees with the overlay: %s', (_label, beds) => {
    expect(collectDuplicateActiveEpisodeIds(beds)).toEqual(
      collectClinicalDerivedEpisodes({ beds }).duplicateEpisodeIds
    );
  });

  it('reports the repeated ids', () => {
    expect(collectDuplicateActiveEpisodeIds(cases[2]![1])).toEqual(['ep_newborn']);
    expect(collectDuplicateActiveEpisodeIds(undefined)).toEqual([]);
  });
});
