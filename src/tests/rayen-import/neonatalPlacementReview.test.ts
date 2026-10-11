import { requiresReview } from '@/features/rayen-import/domain/censusReconciliationPredicates';
import { hasNoApplicableRayenStructuralChanges } from '@/features/rayen-import/hooks/rayenSnapshotPlanningDecision';
import { describe, expect, it } from 'vitest';
import { reconcileCensus, applyCensusImportDiff } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import {
  encounter,
  newborn,
  snapshotOf,
  REFERENCE,
  recordWith,
  seed,
} from './clinicalCribDischargePromotion.fixtures';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientDataSchema } from '@/schemas/zod/patient';

const at = '2026-07-08T20:00:00-06:00';
const effectiveAt = '2026-07-08T14:00:00-06:00';
const prepare = () => {
  const mother = encounter();
  const child = {
    ...newborn(),
    run: '222222222',
    firstGivenName: 'RN de Desconocida',
    firstFamilyName: 'Otra',
  };
  const record = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
  const diff = reconcileCensus(record, snapshotOf([mother, child]), { reference: REFERENCE });
  return { record, diff, mother, child };
};
const apply = (record: DailyRecord, diff: ReturnType<typeof reconcileCensus>) =>
  applyCensusImportDiff(record, diff, {
    now: new Date(at),
    idFactory: () => 'review',
    syncRunId: 'review',
    actor: 'Nurse',
  }).record;

describe('explicit RN placement review', () => {
  it('retains maternal lookup identity separately when an independent RN still carries the parental RUN', () => {
    const { record, mother } = prepare();
    const child = { ...newborn(), run: mother.run };
    const base = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    const saved = apply(
      base,
      resolveNeonatalPlacements(
        base,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.NEO1.neonatalPlacementDecision?.maternalRut).toBe(seed(child).rut);
    expect(saved.beds.NEO1.rut).toBe('');
    expect(saved.beds.NEO1.identityStatus).toBe('provisional');
    expect(PatientDataSchema.parse(saved.beds.NEO1).neonatalPlacementDecision?.maternalRut).toBe(
      seed(child).rut
    );
  });
  it('does not ask for a manual care onset when the ordinary source bed already agrees with HHR', () => {
    const { record, mother } = prepare();
    const child = {
      ...newborn(),
      run: '222222222',
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const base = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(diff.neonatalPlacementReviews).toEqual([]);
    expect(diff.neonatalSourceChanges).toBeUndefined();
  });
  it('captures the source maternal identifier while preserving the existing independent RN own document', () => {
    const { record, mother, child } = prepare();
    const source = { ...child, run: mother.run };
    const base = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(base, snapshotOf([mother, source]), { reference: REFERENCE });
    const saved = apply(
      base,
      resolveNeonatalPlacements(
        base,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.NEO1.rut).toBe(seed(child).rut);
    expect(saved.beds.NEO1.neonatalPlacementDecision?.maternalRut).toBe(seed(mother).rut);
  });
  it('never records the independently reviewed RN own document as a maternal identifier', () => {
    const { record, mother, child } = prepare();
    const base = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    const saved = apply(
      base,
      resolveNeonatalPlacements(
        base,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.NEO1.neonatalPlacementDecision?.maternalRut).toBeUndefined();
    expect(saved.beds.NEO1.rut).toBe(seed(child).rut);
  });
  it('does not offer or overwrite a crib already claimed by an automatic update in the same plan', () => {
    const { record, mother, child } = prepare();
    const automatic = { ...newborn(), encounterId: 'AUTO_RN' };
    const other = encounter({
      encounterId: 'OTHER',
      run: '123456785',
      firstGivenName: 'Otra',
      firstFamilyName: 'Madre',
      room: 'R3',
      bed: 'R3',
    });
    const base = { ...record, beds: { ...record.beds, R3: seed(other) } };
    const diff = reconcileCensus(
      base,
      snapshotOf([
        mother,
        other,
        automatic,
        { ...child, bed: 'CR3', clinicalCribParentBedId: 'R3' },
      ]),
      {
        reference: REFERENCE,
      }
    );
    const review = diff.neonatalPlacementReviews!.find(r => r.episodeId === 'NEWBORN')!;
    expect(diff.updates.some(u => u.changes.some(c => c.field === 'clinicalCrib'))).toBe(true);
    expect(review.mothers.some(m => m.episodeId === 'MOTHER')).toBe(true);
    expect(() =>
      resolveNeonatalPlacements(
        base,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
        at,
        'Nurse'
      )
    ).toThrow(/cuna asignada/);
    const deferred = resolveNeonatalPlacements(
      base,
      diff,
      [{ episodeId: 'NEWBORN', kind: 'deferred', bedId: '' }],
      at,
      'Nurse'
    );
    expect(apply(base, deferred).beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe('AUTO_RN');
  });
  it('requires an explicit decision and keeps a deliberately deferred RN unassociated', () => {
    const { record, diff } = prepare();
    expect(() => resolveNeonatalPlacements(record, diff, [], at, 'Nurse')).toThrow(/cada RN/);
    const deferred = resolveNeonatalPlacements(
      record,
      diff,
      [{ episodeId: 'NEWBORN', kind: 'deferred', bedId: '' }],
      at,
      'Nurse'
    );
    expect(deferred.conflicts).toEqual(diff.conflicts);
    expect(deferred.updates).toHaveLength(0);
    expect(deferred.neonatalPlacementReviews).toHaveLength(1);
  });
  it('rejects a mother replaced by another episode in the same bed after review', () => {
    const { record, child } = prepare();
    const replacement = encounter({ encounterId: 'OTHER_MOTHER', run: '144700554' });
    const fresh = { ...record, beds: { H5C1: seed(replacement) } };
    const replanned = reconcileCensus(fresh, snapshotOf([replacement, child]), {
      reference: REFERENCE,
    });
    expect(() =>
      resolveNeonatalPlacements(
        fresh,
        replanned,
        [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
        at,
        'Nurse'
      )
    ).toThrow(/madre/);
  });
  it('propagates the selected mother identifier when she is new or moving', () => {
    const { record, child, mother } = prepare();
    const bases: DailyRecord[] = [
      { ...record, beds: {} },
      { ...record, beds: { H4C1: { ...seed(mother), bedId: 'H4C1' } } },
    ];
    for (const fresh of bases) {
      const diff = reconcileCensus(fresh, snapshotOf([mother, child]), { reference: REFERENCE });
      const resolved = resolveNeonatalPlacements(
        fresh,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
        at,
        'Nurse'
      );
      expect(resolved.activeClinicalCribs?.[0].principalRut).toBe(seed(mother).rut);
    }
  });
  it.each([false, true])(
    'rejects a moving mother destination that became occupied or blocked: %s',
    blocked => {
      const { record, child, mother } = prepare();
      const fresh = { ...record, beds: { H4C1: { ...seed(mother), bedId: 'H4C1' } } };
      const diff = reconcileCensus(fresh, snapshotOf([mother, child]), { reference: REFERENCE });
      const occupiedDestination = {
        ...fresh,
        beds: {
          ...fresh.beds,
          H5C1: {
            ...seed(mother),
            clinicalEpisodeId: blocked ? mother.encounterId : 'OTHER',
            isBlocked: blocked,
            clinicalCrib: { ...seed(child), clinicalEpisodeId: 'OTHER-RN' },
          },
        },
      };
      expect(() =>
        resolveNeonatalPlacements(
          occupiedDestination,
          diff,
          [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
          at,
          'Nurse'
        )
      ).toThrow(/destino/);
    }
  );
  it('preserves the independent RN own identifier when the source carries the progenitor RUN', () => {
    const { record, mother, child } = prepare();
    const independent = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(independent, snapshotOf([mother, { ...child, run: mother.run }]), {
      reference: REFERENCE,
    });
    expect(
      diff.updates.some(u => u.bedId === 'NEO1' && u.changes.some(c => c.field === 'rut'))
    ).toBe(false);
    expect(diff.moves).toHaveLength(0);
  });

  it('shows the mother and all independent beds, enabling only available units', () => {
    const { diff } = prepare();
    expect(diff.neonatalPlacementReviews?.[0].mothers).toMatchObject([
      { bedId: 'H5C1', episodeId: 'MOTHER' },
    ]);
    expect(diff.neonatalPlacementReviews?.[0].independentBeds).toContain('H5C1');
    expect(diff.neonatalPlacementReviews?.[0].unavailableIndependentBeds).toContain('H5C1');
    expect(diff.updates).toHaveLength(0);
    expect(requiresReview(diff)).toBe(true);
    expect(hasNoApplicableRayenStructuralChanges(diff)).toBe(false);
  });
  it('stores a reviewed mother association and preserves it on a later sync', () => {
    const { record, diff, mother, child } = prepare();
    const resolved = resolveNeonatalPlacements(
      record,
      diff,
      [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
      at,
      'Nurse'
    );
    const saved = apply(record, resolved);
    expect(saved.beds.H5C1.clinicalCrib?.neonatalPlacementDecision).toMatchObject({
      kind: 'mother',
      parentEpisodeId: 'MOTHER',
      reviewedBy: 'Nurse',
    });
    const again = reconcileCensus(
      saved,
      snapshotOf([mother, { ...child, bed: 'CR3', clinicalCribParentBedId: 'R3' }]),
      { reference: REFERENCE }
    );
    expect(again.conflicts.some(c => c.neonatalAssociationReview)).toBe(true);
    expect(again.admissions).toHaveLength(0);
    expect(again.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
    expect(
      PatientDataSchema.parse(saved.beds.H5C1.clinicalCrib).neonatalPlacementDecision?.kind
    ).toBe('mother');
  });
  it('preserves an independent RN bed despite the erroneous source crib code', () => {
    const { record, diff, mother, child } = prepare();
    const saved = apply(
      record,
      resolveNeonatalPlacements(
        record,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.NEO1).toMatchObject({ bedMode: 'Cama', clinicalEpisodeId: 'NEWBORN' });
    expect(saved.beds.H5C1.clinicalCrib).toBeUndefined();
    const again = reconcileCensus(saved, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(again.moves).toHaveLength(0);
    expect(again.conflicts).toHaveLength(0);
    expect(again.admissions).toHaveLength(0);
  });
  it('respects an existing manually configured independent bed, requesting its effective time once', () => {
    const { record, mother, child } = prepare();
    const already = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(already, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(diff.moves).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.neonatalPlacementReviews?.[0]).toMatchObject({
      existingBedId: 'NEO1',
      mothers: [{ bedId: 'H5C1', episodeId: 'MOTHER', name: 'Ana Perez' }],
      independentBeds: expect.arrayContaining(['NEO1', 'R3']),
      unavailableIndependentBeds: expect.arrayContaining(['H5C1']),
    });
    expect(diff.neonatalPlacementReviews?.[0].unavailableIndependentBeds).not.toContain('R3');
    const saved = apply(
      already,
      resolveNeonatalPlacements(
        already,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.NEO1.neonatalPlacementDecision?.kind).toBe('independent');
    expect(
      reconcileCensus(saved, snapshotOf([mother, child]), { reference: REFERENCE })
        .neonatalPlacementReviews
    ).toEqual([]);
  });

  it.each(['', 'UNKNOWN'])('rejects an unoffered destination %s for an independent RN', bedId => {
    const { record, mother, child } = prepare();
    const current = {
      ...record,
      beds: { ...record.beds, NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' as const } },
    };
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(() =>
      resolveNeonatalPlacements(
        current,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'independent', bedId, effectiveAt }],
        at,
        'Nurse'
      )
    ).toThrow('La cama independiente no está disponible');
  });

  it('keeps the newly registered personal RUN when an existing independent RN joins its mother', () => {
    const { record, mother, child } = prepare();
    const current = {
      ...record,
      beds: {
        ...record.beds,
        NEO1: {
          ...seed({ ...child, run: '' }),
          bedId: 'NEO1',
          bedMode: 'Cama' as const,
          identityStatus: 'provisional' as const,
        },
      },
    };
    const registered = { ...child, run: '123456785', firstGivenName: 'Nombre confirmado' };
    const diff = reconcileCensus(current, snapshotOf([mother, registered]), {
      reference: REFERENCE,
    });
    const saved = apply(
      current,
      resolveNeonatalPlacements(
        current,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'H5C1', parentEpisodeId: 'MOTHER' }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.H5C1.clinicalCrib).toMatchObject({
      rut: '12.345.678-5',
      identityStatus: 'official',
    });
    expect(saved.beds.NEO1.patientName).toBe('');
  });

  it('rejects a stale occupied destination, duplicate choices and an unknown mother', () => {
    const { record, diff } = prepare();
    const choices = [
      { episodeId: 'NEWBORN', kind: 'independent' as const, bedId: 'NEO1', effectiveAt },
    ];
    expect(() =>
      resolveNeonatalPlacements(
        { ...record, beds: { ...record.beds, NEO1: seed(encounter({ encounterId: 'OTHER' })) } },
        diff,
        choices,
        at,
        'Nurse'
      )
    ).toThrow();
    expect(() =>
      resolveNeonatalPlacements(record, diff, [...choices, ...choices], at, 'Nurse')
    ).toThrow();
    expect(() =>
      resolveNeonatalPlacements(
        record,
        diff,
        [{ episodeId: 'NEWBORN', kind: 'mother', bedId: 'R3', parentEpisodeId: '2001' }],
        at,
        'Nurse'
      )
    ).toThrow();
  });
  it('requires an explicit nonfuture independent onset after admission', () => {
    const { record, diff } = prepare();
    for (const when of [undefined, '2026-07-09T14:00:00-06:00', '2026-07-07T14:00:00-06:00']) {
      expect(() =>
        resolveNeonatalPlacements(
          record,
          diff,
          [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt: when }],
          at,
          'Nurse'
        )
      ).toThrow();
    }
  });
  it('does not invent an admission boundary for independent hospital care', () => {
    const { record, diff } = prepare();
    for (const admissionDatetime of ['', 'not-a-date']) {
      const uncertain = {
        ...diff,
        neonatalPlacementReviews: diff.neonatalPlacementReviews?.map(r => ({
          ...r,
          source: { ...r.source, admissionDatetime },
        })),
      };
      expect(() =>
        resolveNeonatalPlacements(
          record,
          uncertain,
          [{ episodeId: 'NEWBORN', kind: 'independent', bedId: 'NEO1', effectiveAt }],
          at,
          'Nurse'
        )
      ).toThrow(/ingreso/);
    }
  });
});
