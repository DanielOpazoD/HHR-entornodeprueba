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
import { resolveCudyrDailyPlacement } from '@/domain/cudyr/cudyrDailyPlacement';

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

describe('reviewed RN CUDYR eligibility', () => {
  it('offers and accepts the source hospital bed when an already nested RN becomes independent', () => {
    const mother = encounter(),
      child = newborn();
    const current = recordWith(mother, child);
    const independent = {
      ...child,
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const diff = reconcileCensus(current, snapshotOf([mother, independent]), {
      reference: REFERENCE,
    });
    expect(diff.neonatalPlacementReviews?.[0]?.existingKind).toBe('mother');
    expect(diff.neonatalPlacementReviews?.[0]?.unavailableIndependentBeds).not.toContain('NEO1');
    const saved = apply(
      current,
      resolveNeonatalPlacements(
        current,
        diff,
        [{ episodeId: child.encounterId, kind: 'independent', bedId: 'NEO1', effectiveAt }],
        at,
        'Nurse'
      )
    );
    expect(saved.beds.H5C1.clinicalCrib).toBeUndefined();
    expect(saved.beds.NEO1).toMatchObject({
      clinicalEpisodeId: child.encounterId,
      bedMode: 'Cama',
    });
  });
  it('uses reviewed care from its effective instant, without changing earlier nights or creating CUDYR', () => {
    const { record, diff } = prepare();
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
    const decision = saved.beds.NEO1.neonatalPlacementDecision!;
    const resolve = (date: string, careAt = effectiveAt) =>
      resolveCudyrDailyPlacement({
        date,
        clinicalEpisodeId: 'NEWBORN',
        patientName: saved.beds.NEO1.patientName,
        sourcePlacements: [],
        useCensusAdmission: true,
        placements: [
          {
            bedId: 'NEO1',
            section: 'census',
            bedMode: 'Cama',
            neonatalPlacementDecision: { ...decision, effectiveAt: careAt },
          },
        ],
      });
    expect(resolve('2026-07-08').eligibility).toBe('elegible');
    expect(resolve('2026-07-08').contextSource).toBe('hhr_daily');
    expect(resolve('2026-07-08', at).eligibility).toBe('no_elegible');
    expect(resolve('2026-07-07').reason).not.toContain('Ubicación RN confirmada');
    expect(saved.beds.NEO1.cudyr).toBeUndefined();
    expect(saved.beds.NEO1.evaluationScores?.cudyr).toBeUndefined();
  });
});
