import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { requiresReview } from '@/features/rayen-import/domain/censusReconciliationPredicates';
import {
  encounter,
  newborn,
  seed,
  recordWith,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';

describe('legacy bed-only RN association repair', () => {
  it('recovers a removed RN quietly when the proven mother and source crib coincide', () => {
    const mother = encounter();
    const child = { ...newborn(), run: mother.run };
    const base = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
    const diff = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(requiresReview(diff)).toBe(false);
    expect(diff.neonatalPlacementReviews).toEqual([]);
    expect(diff.updates).toMatchObject([{ bedId: 'H5C1', changes: [{ field: 'clinicalCrib' }] }]);
    const result = applyCensusImportDiff(base, diff, {
      now: new Date('2026-07-08T20:00:00-06:00'),
      idFactory: () => 'recover',
      syncRunId: 'recover',
      actor: 'Nurse',
    });
    expect(result.skipped).toEqual([]);
    expect(result.record.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe(child.encounterId);
  });
  it.each([false, true])(
    'resolves two incorrect existing links independent of selection order: %s',
    reversed => {
      const mother = encounter();
      const other = encounter({
        encounterId: 'OTHER',
        run: '123456785',
        firstGivenName: 'Otra',
        firstFamilyName: 'Madre',
        room: 'R3',
        bed: 'R3',
      });
      const child = { ...newborn(), run: mother.run };
      const second = {
        ...newborn(),
        encounterId: 'SECOND',
        run: other.run,
        firstGivenName: 'RN de Otra',
        firstFamilyName: 'Madre',
        bed: 'CR3',
        clinicalCribParentBedId: 'R3',
      };
      const base = {
        ...recordWith(mother, child),
        beds: {
          H5C1: { ...seed(mother), clinicalCrib: { ...seed(second), bedId: 'H5C1' } },
          R3: { ...seed(other), clinicalCrib: { ...seed(child), bedId: 'R3' } },
        },
      };
      const diff = reconcileCensus(base, snapshotOf([mother, other, child, second]), {
        reference: REFERENCE,
      });
      const choices = [
        {
          episodeId: child.encounterId,
          kind: 'mother' as const,
          bedId: 'H5C1',
          parentEpisodeId: mother.encounterId,
        },
        {
          episodeId: second.encounterId,
          kind: 'mother' as const,
          bedId: 'R3',
          parentEpisodeId: other.encounterId,
        },
      ];
      const reviewed = resolveNeonatalPlacements(
        base,
        diff,
        reversed ? choices.reverse() : choices,
        '2026-07-08T20:00:00-06:00',
        'Nurse'
      );
      const saved = applyCensusImportDiff(base, reviewed, {
        now: REFERENCE,
        syncRunId: 'swap',
        idFactory: () => 'swap',
      }).record;
      expect(saved.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe(child.encounterId);
      expect(saved.beds.R3.clinicalCrib?.clinicalEpisodeId).toBe(second.encounterId);
      expect(saved.discharges).toEqual([]);
      expect(reviewed.conflicts).toEqual([]);
    }
  );
  it('offers an explicit reassociation and releases the former mother slot for her own RN', () => {
    const mother = encounter();
    const other = encounter({
      encounterId: 'OTHER',
      run: '123456785',
      firstGivenName: 'Otra',
      firstFamilyName: 'Madre',
      room: 'R3',
      bed: 'R3',
    });
    const child = { ...newborn(), run: mother.run, firstGivenName: 'RN de Ana Perez' };
    const second = {
      ...newborn(),
      encounterId: 'SECOND',
      run: other.run,
      firstGivenName: 'RN de Otra',
      firstFamilyName: 'Madre',
      bed: 'C-R2',
      clinicalCribParentBedId: 'R2',
    };
    const base = {
      ...recordWith(mother, child),
      beds: {
        H5C1: seed(mother),
        R3: { ...seed(other), clinicalCrib: { ...seed(child), bedId: 'R3' } },
      },
    };
    const snap = snapshotOf([mother, other, child, second]);
    const initial = reconcileCensus(base, snap, { reference: REFERENCE });
    expect(initial.neonatalPlacementReviews?.map(r => r.episodeId)).toEqual(['NEWBORN', 'SECOND']);
    expect(initial.neonatalPlacementReviews?.[0].mothers).toContainEqual({
      bedId: 'H5C1',
      episodeId: 'MOTHER',
      name: seed(mother).patientName,
    });
    const reviewed = resolveNeonatalPlacements(
      base,
      initial,
      [
        { episodeId: 'SECOND', kind: 'mother', bedId: 'R3', parentEpisodeId: 'OTHER' },
        { episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' },
      ],
      '2026-07-08T20:00:00-06:00',
      'Nurse'
    );
    const applied = applyCensusImportDiff(base, reviewed, {
      now: REFERENCE,
      syncRunId: 'repair',
      idFactory: () => 'repair',
    }).record;
    expect(initial.neonatalPlacementReviews?.[1].mothers).toEqual(
      expect.arrayContaining([expect.objectContaining({ bedId: 'R3', episodeId: 'OTHER' })])
    );
    expect(applied.beds.R3.clinicalCrib?.clinicalEpisodeId).toBe('SECOND');
    expect(applied.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      rut: '',
      bedMode: 'Cuna',
    });
    expect(applied.discharges).toEqual([]);
    const next = reconcileCensus(applied, snap, { reference: REFERENCE });
    expect(requiresReview(next)).toBe(false);
    const final = applyCensusImportDiff(applied, next, {
      now: REFERENCE,
      syncRunId: 'next',
      idFactory: () => 'next',
    }).record;
    expect(final.beds.R3.clinicalCrib?.clinicalEpisodeId).toBe('SECOND');
    expect(final.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe('NEWBORN');
    expect(final.discharges).toEqual([]);
  });
});
