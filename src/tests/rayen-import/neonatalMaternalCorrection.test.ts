import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { requiresReview } from '@/features/rayen-import/domain/censusReconciliationPredicates';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
const at = '2026-07-08T20:00:00-06:00';
const apply = (current: ReturnType<typeof recordWith>, diff: ReturnType<typeof reconcileCensus>) =>
  applyCensusImportDiff(current, diff, {
    now: new Date(at),
    idFactory: () => 'review',
    syncRunId: 'review',
    actor: 'Nurse',
  }).record;

describe('reviewed maternal identity correction', () => {
  it('accepts a newly registered personal RUN without repeating the accepted bed review', () => {
    const mother = encounter();
    const child = { ...newborn(), room: 'Cunas', bed: 'CR3', clinicalCribParentBedId: 'R3' };
    const current = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
    const initial = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    const saved = apply(
      current,
      resolveNeonatalPlacements(
        current,
        initial,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'H5C1',
            parentEpisodeId: mother.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    );
    const registered = { ...child, run: '123456785', firstGivenName: 'Nombre confirmado' };
    const next = reconcileCensus(saved, snapshotOf([mother, registered]), { reference: REFERENCE });
    expect(next.neonatalPlacementReviews).toEqual([]);
    expect(next.neonatalSourceChanges ?? []).toEqual([]);
    const updated = apply(saved, next);
    expect(updated.beds.H5C1.clinicalCrib?.rut).toBe('12.345.678-5');
    expect(updated.beds.H5C1.clinicalCrib?.neonatalPlacementDecision?.sourceRun).toBe(
      registered.run
    );
  });

  it('reviews a stale nested child when another maternal episode occupies the same bed', () => {
    const mother = encounter();
    const other = encounter({ encounterId: 'OTHER', run: '123456785', firstGivenName: 'Otra' });
    const child = { ...newborn(), run: '222222222', firstGivenName: 'RN de Desconocida' };
    const base = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
    const initial = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    const saved = apply(
      base,
      resolveNeonatalPlacements(
        base,
        initial,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'H5C1',
            parentEpisodeId: mother.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    );
    const movedMother = { ...mother, room: 'R3', bed: 'R3' };
    const reused: typeof saved = {
      ...saved,
      beds: {
        H5C1: { ...seed(other), clinicalCrib: saved.beds.H5C1.clinicalCrib },
        R3: seed(movedMother),
      },
    };
    const diff = reconcileCensus(reused, snapshotOf([movedMother, other, child]), {
      reference: REFERENCE,
    });
    expect(requiresReview(diff)).toBe(true);
    expect(diff.neonatalPlacementReviews?.[0].existingKind).toBe('mother');
    const deferred = apply(
      reused,
      resolveNeonatalPlacements(
        reused,
        diff,
        [{ episodeId: child.encounterId, kind: 'deferred', bedId: '' }],
        at,
        'Nurse'
      )
    );
    expect(deferred.beds.H5C1.clinicalCrib?.neonatalPlacementDecision).toMatchObject({
      parentEpisodeId: mother.encounterId,
      maternalRut: seed(mother).rut,
    });
    const confirmed = apply(
      reused,
      resolveNeonatalPlacements(
        reused,
        diff,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'R3',
            parentEpisodeId: mother.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    );
    expect(confirmed.beds.H5C1.clinicalCrib).toBeUndefined();
    expect(confirmed.beds.R3.clinicalCrib?.neonatalPlacementDecision?.parentEpisodeId).toBe(
      mother.encounterId
    );
    expect(confirmed.discharges).toEqual([]);
  });

  it('clears the previous maternal RUN when reassociating to a mother without a valid RUN', () => {
    const mother = encounter();
    const other = encounter({
      encounterId: 'OTHER',
      run: '',
      room: 'R3',
      bed: 'R3',
      firstGivenName: 'Otra',
    });
    const child = { ...newborn(), run: '222222222', firstGivenName: 'RN de Desconocida' };
    const base = { ...recordWith(mother, child), beds: { H5C1: seed(mother), R3: seed(other) } };
    const initial = reconcileCensus(base, snapshotOf([mother, other, child]), {
      reference: REFERENCE,
    });
    const saved = apply(
      base,
      resolveNeonatalPlacements(
        base,
        initial,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'H5C1',
            parentEpisodeId: mother.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.H5C1.clinicalCrib?.neonatalMaternalRut).toBe(seed(mother).rut);
    const next = reconcileCensus(
      saved,
      snapshotOf([mother, other, { ...child, bed: 'CR3', clinicalCribParentBedId: 'R3' }]),
      { reference: REFERENCE }
    );
    const updated = apply(
      saved,
      resolveNeonatalPlacements(
        saved,
        next,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'R3',
            parentEpisodeId: other.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    );
    expect(updated.beds.R3.clinicalCrib?.neonatalPlacementDecision?.parentEpisodeId).toBe(
      other.encounterId
    );
    expect(updated.beds.R3.clinicalCrib?.neonatalPlacementDecision?.maternalRut).toBeUndefined();
    expect(updated.beds.R3.clinicalCrib?.neonatalMaternalRut).toBeUndefined();
  });

  it('reviews a source identifier that matches the selected mother and another episode', () => {
    const mother = encounter();
    const other = encounter({
      encounterId: 'OTHER',
      run: mother.run,
      room: 'R3',
      bed: 'R3',
      firstGivenName: 'Otra',
    });
    const child = { ...newborn(), run: '222222222', firstGivenName: 'RN de Desconocida' };
    const base = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
    const initial = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    const saved = apply(
      base,
      resolveNeonatalPlacements(
        base,
        initial,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'H5C1',
            parentEpisodeId: mother.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    );
    const diff = reconcileCensus(
      saved,
      snapshotOf([mother, other, { ...child, run: mother.run }]),
      { reference: REFERENCE }
    );
    expect(requiresReview(diff)).toBe(true);
    expect(diff.neonatalPlacementReviews?.map(r => r.episodeId)).toContain(child.encounterId);
    expect(saved.beds.H5C1.clinicalCrib?.rut).toBe(seed(child).rut);
  });
  it.each([false, true])(
    'keeps the chosen mother and reviews foreign source episodes (multiple: %s)',
    multiple => {
      const mother = encounter();
      const other = encounter({
        encounterId: 'OTHER',
        run: '123456785',
        firstGivenName: 'Otra',
        room: 'R3',
        bed: 'R3',
      });
      const child = { ...newborn(), run: '222222222', firstGivenName: 'RN de Desconocida' };
      const base: ReturnType<typeof recordWith> = {
        ...recordWith(mother, child),
        beds: { H5C1: seed(mother), R3: seed(other) },
      };
      const extra = multiple
        ? [encounter({ ...other, encounterId: 'OTHER-SECOND', room: 'R4', bed: 'R4' })]
        : [];
      if (multiple) base.beds.R4 = seed(extra[0]);
      const sources = (rn: typeof child) => snapshotOf([mother, other, ...extra, rn]);
      const initial = reconcileCensus(base, sources(child), {
        reference: REFERENCE,
      });
      const chooseMother = (current: typeof base, diff: typeof initial) =>
        resolveNeonatalPlacements(
          current,
          diff,
          [
            {
              episodeId: child.encounterId,
              kind: 'mother',
              bedId: 'H5C1',
              parentEpisodeId: mother.encounterId,
            },
          ],
          at,
          'Nurse'
        );
      const saved = apply(base, chooseMother(base, initial));
      const changed = { ...child, run: other.run };
      const diff = reconcileCensus(saved, sources(changed), {
        reference: REFERENCE,
      });
      expect(requiresReview(diff)).toBe(true);
      expect(diff.neonatalPlacementReviews?.[0].existingKind).toBe('mother');
      const deferred = apply(
        saved,
        resolveNeonatalPlacements(
          saved,
          diff,
          [{ episodeId: child.encounterId, kind: 'deferred', bedId: '' }],
          at,
          'Nurse'
        )
      );
      expect(deferred.beds.H5C1.clinicalCrib?.neonatalPlacementDecision?.sourceRun).toBe(child.run);
      const confirmed = apply(saved, chooseMother(saved, diff));
      expect(confirmed.beds.H5C1.clinicalCrib).toMatchObject({
        rut: seed(child).rut,
        neonatalPlacementDecision: {
          parentEpisodeId: mother.encounterId,
          maternalRut: seed(mother).rut,
          sourceRun: other.run,
        },
      });
      const repeated = reconcileCensus(confirmed, sources(changed), {
        reference: REFERENCE,
      });
      expect(requiresReview(repeated)).toBe(false);
      const again = apply(confirmed, repeated);
      const withoutForeignMother = { ...again, beds: { H5C1: again.beds.H5C1 } };
      const afterForeignDischarge = reconcileCensus(
        withoutForeignMother,
        snapshotOf([mother, changed]),
        { reference: REFERENCE }
      );
      expect(requiresReview(afterForeignDischarge)).toBe(false);
      const preserved = apply(withoutForeignMother, afterForeignDischarge);
      expect(preserved.beds.H5C1.clinicalCrib?.rut).toBe(seed(child).rut);
      expect(preserved.beds.H5C1.clinicalCrib?.neonatalPlacementDecision?.sourceRunIsMaternal).toBe(
        true
      );
      const corrected = { ...child, run: mother.run };
      const correction = reconcileCensus(again, sources(corrected), {
        reference: REFERENCE,
      });
      expect(requiresReview(correction)).toBe(false);
      const acknowledged = apply(again, correction);
      expect(acknowledged.beds.H5C1.clinicalCrib?.neonatalPlacementDecision?.maternalRut).toBe(
        seed(mother).rut
      );
      expect(
        requiresReview(
          reconcileCensus(acknowledged, sources(changed), {
            reference: REFERENCE,
          })
        )
      ).toBe(true);
    }
  );
});
