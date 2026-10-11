import { describe, expect, it } from 'vitest';
import { reconcileCensus, applyCensusImportDiff } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { resolveCudyrDailyPlacement } from '@/domain/cudyr/cudyrDailyPlacement';
import { assertNeonatalSourceChangesReviewed } from '@/features/rayen-import/domain/reviewedNeonatalSourcePlacement';
import { requiresReview } from '@/features/rayen-import/domain/censusReconciliationPredicates';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
const at = '2026-07-08T20:00:00-06:00';
const effectiveAt = '2026-07-08T14:00:00-06:00';
const apply = (record: DailyRecord, diff: CensusImportDiff) =>
  applyCensusImportDiff(record, diff, {
    now: new Date(at),
    idFactory: () => 'review',
    syncRunId: 'review',
    actor: 'Nurse',
  }).record;
const reviewed = (kind: 'mother' | 'independent') => {
  const mother = encounter();
  const child = {
    ...newborn(),
    run: '222222222',
    firstGivenName: 'RN de Desconocida',
    firstFamilyName: 'Otra',
  };
  const record = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
  const diff = reconcileCensus(record, snapshotOf([mother, child]), { reference: REFERENCE });
  const saved = apply(
    record,
    resolveNeonatalPlacements(
      record,
      diff,
      [
        {
          episodeId: 'NEWBORN',
          kind,
          bedId: kind === 'mother' ? 'H5C1' : 'NEO1',
          parentEpisodeId: kind === 'mother' ? 'MOTHER' : undefined,
          effectiveAt,
        },
      ],
      at,
      'Nurse'
    )
  );
  return { mother, child, saved };
};
describe('RN source corrections and later transfers', () => {
  it('acknowledges a matching independent-bed correction and asks again for a later different bed', () => {
    const { mother, child, saved } = reviewed('independent');
    const corrected = { ...child, room: 'Neo 1', bed: 'Neo1', clinicalCribParentBedId: undefined };
    const first = reconcileCensus(saved, snapshotOf([mother, corrected]), { reference: REFERENCE });
    expect(first.neonatalPlacementReviews).toEqual([]);
    expect(first.neonatalSourceChanges).toBeUndefined();
    expect(first.moves).toHaveLength(0);
    expect(requiresReview(first)).toBe(false);
    const acknowledged = apply(saved, first);
    const again = reconcileCensus(acknowledged, snapshotOf([mother, corrected]), {
      reference: REFERENCE,
    });
    expect(again.updates).toHaveLength(0);
    const moved = { ...corrected, room: 'R3', bed: 'R3' };
    const transfer = reconcileCensus(acknowledged, snapshotOf([mother, moved]), {
      reference: REFERENCE,
    });
    expect(requiresReview(transfer)).toBe(true);
    expect(transfer.neonatalSourceChanges).toMatchObject([
      { episodeId: 'NEWBORN', hhrBedId: 'NEO1', sourceBedId: 'R3' },
    ]);
    expect(() => assertNeonatalSourceChangesReviewed(transfer, [])).toThrow(/ubicación/);
    expect(() => assertNeonatalSourceChangesReviewed(transfer, ['NEWBORN'])).not.toThrow();
    const confirmed = apply(acknowledged, transfer);
    expect(confirmed.beds.R3.neonatalPlacementDecision).toMatchObject({
      kind: 'independent',
      bedId: 'R3',
      effectiveAt,
    });
    const daily = resolveCudyrDailyPlacement({
      date: '2026-07-08',
      patientName: confirmed.beds.R3.patientName,
      clinicalEpisodeId: 'NEWBORN',
      placements: [{ ...confirmed.beds.R3, bedId: 'R3', section: 'census' }],
      sourcePlacements: [
        {
          observedAt: at,
          censusDate: '2026-07-08',
          captureId: 'synthetic',
          placement: {
            clinicalEpisodeId: 'NEWBORN',
            sourceMappingId: 'R3',
            sourceBedId: 'R3',
            sourceBedLabel: 'R3',
            sourceDepartmentId: 'hospital',
            sourceDepartmentLabel: child.service!,
            sourceVersion: '1',
            sourceStartAt: '2026-07-08T19:00:00-06:00',
            sourceEndAt: '',
            currentAssignment: true,
            isDeleted: false,
            bedId: 'R3',
            modality: 'hospitalizacion',
          },
        },
      ],
    });
    expect(daily.hospitalStayAdmissionAt).toBe(effectiveAt);
    expect(daily.eligibility).toBe('elegible');
    expect(confirmed.beds.R3.cudyr).toBeUndefined();
    expect(
      requiresReview(
        reconcileCensus(confirmed, snapshotOf([mother, moved]), { reference: REFERENCE })
      )
    ).toBe(false);
  });
  it.each(['mother', 'independent'] as const)(
    'reviews a later crib source for an independent RN and respects %s choice',
    kind => {
      const { mother, child, saved } = reviewed('independent');
      const corrected = { ...child, bed: 'CR3', clinicalCribParentBedId: 'R3' };
      const diff = reconcileCensus(saved, snapshotOf([mother, corrected]), {
        reference: REFERENCE,
      });
      expect(diff.neonatalPlacementReviews?.[0]).toMatchObject({
        existingBedId: 'NEO1',
        existingKind: 'independent',
      });
      expect(requiresReview(diff)).toBe(true);
      const bedId = kind === 'mother' ? 'H5C1' : 'R3';
      const resolved = resolveNeonatalPlacements(
        saved,
        diff,
        [
          {
            episodeId: child.encounterId,
            kind,
            bedId,
            parentEpisodeId: kind === 'mother' ? mother.encounterId : undefined,
            effectiveAt,
          },
        ],
        at,
        'Nurse'
      );
      const confirmed = apply(saved, resolved);
      expect(confirmed.beds.NEO1?.patientName || '').toBe('');
      expect(
        kind === 'mother'
          ? confirmed.beds.H5C1.clinicalCrib?.clinicalEpisodeId
          : confirmed.beds.R3.clinicalEpisodeId
      ).toBe(child.encounterId);
      expect(confirmed.discharges).toHaveLength(0);
      expect(
        requiresReview(
          reconcileCensus(confirmed, snapshotOf([mother, corrected]), { reference: REFERENCE })
        )
      ).toBe(false);
    }
  );
  it.each([false, true])(
    'keeps the RN personal identity when the maternal lookup was previously known: %s',
    alreadyKnown => {
      const { mother, child, saved } = reviewed('independent');
      if (alreadyKnown) saved.beds.NEO1.neonatalPlacementDecision!.maternalRut = seed(mother).rut;
      const corrected = {
        ...child,
        run: mother.run,
        room: 'Neo 1',
        bed: 'Neo1',
        clinicalCribParentBedId: undefined,
      };
      const diff = reconcileCensus(saved, snapshotOf([mother, corrected]), {
        reference: REFERENCE,
      });
      expect(diff.neonatalPlacementReviews).toEqual([]);
      expect(diff.neonatalSourceChanges).toBeUndefined();
      const correctedRecord = apply(saved, diff);
      expect(correctedRecord.beds.NEO1.rut).toBe(seed(child).rut);
      expect(correctedRecord.beds.NEO1.neonatalPlacementDecision?.maternalRut).toBe(
        seed(mother).rut
      );
    }
  );
  it('keeps a known mother when the corrected crib matches, but prompts for another source location', () => {
    const { mother, child, saved } = reviewed('mother');
    const corrected = reconcileCensus(saved, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(requiresReview(corrected)).toBe(false);
    const changed = { ...child, bed: 'CR3', clinicalCribParentBedId: 'R3' };
    const next = reconcileCensus(saved, snapshotOf([mother, changed]), { reference: REFERENCE });
    expect(requiresReview(next)).toBe(true);
    expect(next.neonatalPlacementReviews?.[0].episodeId).toBe(child.encounterId);
    const retained = apply(
      saved,
      resolveNeonatalPlacements(
        saved,
        next,
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
    expect(
      requiresReview(
        reconcileCensus(retained, snapshotOf([mother, changed]), { reference: REFERENCE })
      )
    ).toBe(false);
    expect(next.admissions).toHaveLength(0);
  });
  it('requires an explicit care decision to move a known nested RN into an independent bed without duplication', () => {
    const { mother, child, saved } = reviewed('mother');
    const moved = { ...child, room: 'Neo 1', bed: 'Neo1', clinicalCribParentBedId: undefined };
    const diff = reconcileCensus(saved, snapshotOf([mother, moved]), { reference: REFERENCE });
    expect(diff.admissions).toHaveLength(0);
    expect(diff.neonatalPlacementReviews?.[0]).toMatchObject({
      existingKind: 'mother',
      existingBedId: 'H5C1',
    });
    const resolved = resolveNeonatalPlacements(
      saved,
      diff,
      [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
      at,
      'Nurse'
    );
    expect(resolved.conflicts).toHaveLength(0);
    const confirmed = apply(saved, resolved);
    expect(confirmed.beds.H5C1.clinicalCrib).toBeUndefined();
    expect(confirmed.beds.NEO1).toMatchObject({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cama' });
    expect(confirmed.discharges).toHaveLength(0);
    expect(
      requiresReview(
        reconcileCensus(confirmed, snapshotOf([mother, moved]), { reference: REFERENCE })
      )
    ).toBe(false);
  });
});
