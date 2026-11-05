import { describe, expect, it } from 'vitest';
import { scrubInvalidEpisodesFromDiff } from '@/features/rayen-import/domain/invalidClinicalEpisodePolicy';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import type { DischargeEntry } from '@/features/rayen-import/contracts/censusImportDiff';

const motherAlta = (cribEpisode: string): DischargeEntry => ({
  bedId: 'H1C1',
  rut: '12.345.678-5',
  patientName: 'Madre Sintética',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  encounterId: '900100',
  associatedClinicalCrib: {
    clinicalEpisodeId: cribEpisode,
    patientName: 'RN Sintético',
    rut: '12.345.678-5',
  },
});

describe('scrubInvalidEpisodesFromDiff', () => {
  it('keeps a valid mother leaving, without an egreso for her marked newborn', () => {
    const diff = {
      ...createEmptyCensusImportDiff(true),
      discharges: [motherAlta('900200')],
    };
    diff.summary.discharges = 1;

    const scrubbed = scrubInvalidEpisodesFromDiff(diff, new Set(['900200']));

    expect(scrubbed.discharges).toEqual([
      expect.objectContaining({ encounterId: '900100', associatedClinicalCrib: undefined }),
    ]);
    expect(scrubbed.summary.discharges).toBe(1);
    expect(scrubbed.invalidClinicalEpisodeIds).toEqual(['900200']);
  });

  it('keeps the counts the preview shows in step with the entries it removes', () => {
    const diff = {
      ...createEmptyCensusImportDiff(true),
      discharges: [{ ...motherAlta('900300'), encounterId: '900200' }],
      conflicts: [
        { bedId: null, clinicalEpisodeId: '900200', patientName: 'Duplicado', reason: 'Revisar.' },
        { bedId: 'H2C1', clinicalEpisodeId: '900400', patientName: 'Otro', reason: 'Revisar.' },
      ],
    };
    diff.summary.discharges = 1;
    diff.summary.conflicts = 2;

    const scrubbed = scrubInvalidEpisodesFromDiff(diff, new Set(['900200']));

    expect(scrubbed.discharges).toEqual([]);
    expect(scrubbed.summary.discharges).toBe(0);
    expect(scrubbed.conflicts).toHaveLength(1);
    expect(scrubbed.summary.conflicts).toBe(1);
  });

  it('leaves the plan untouched when no episode is marked', () => {
    const diff = { ...createEmptyCensusImportDiff(true), discharges: [motherAlta('900200')] };

    expect(scrubInvalidEpisodesFromDiff(diff, new Set())).toBe(diff);
  });
});
