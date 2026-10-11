import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';

export const REVIEWED_AT = '2026-07-08T20:00:00-06:00';
export const INDEPENDENT_CARE_AT = '2026-07-08T14:00:00-06:00';

/** Fresh synthetic episodes: no shared mutable census or diff between cases. */
export const unassociatedNeonatalSources = () => ({
  mother: encounter(),
  child: {
    ...newborn(),
    run: '222222222',
    firstGivenName: 'RN de Desconocida',
    firstFamilyName: 'Otra',
  },
});

export const prepareNeonatalReview = () => {
  const { mother, child } = unassociatedNeonatalSources();
  const record = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
  const diff = reconcileCensus(record, snapshotOf([mother, child]), { reference: REFERENCE });
  return { record, diff, mother, child };
};

export const applyNeonatalReview = (record: DailyRecord, diff: CensusImportDiff): DailyRecord =>
  applyCensusImportDiff(record, diff, {
    now: new Date(REVIEWED_AT),
    idFactory: () => 'review',
    syncRunId: 'review',
    actor: 'Nurse',
  }).record;
