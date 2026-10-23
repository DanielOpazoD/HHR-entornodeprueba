import type { DailyRecord } from '../contracts/rayenDomainContracts';

export interface ClinicalFillDerivedView {
  /** Combined view (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md, D10): rebuild input only. */
  record: DailyRecord;
  /** The un-overlaid day `record` was built from: the only valid write base, retry or audit input. */
  day: DailyRecord;
}

/**
 * Overlays a split day's episode documents on a record that feeds the Rayen rebuild
 * (`rebuildClinicalEnrichmentOperations`). Documents are read from the server in strict mode; a
 * document ahead of the day re-reads the day once through `reloadDay` (a server read) and then
 * fails closed with `ClinicalDerivedReadError`. A day without a marker comes back as is, without
 * loading the read path or reading anything.
 */
export const readClinicalFillDerivedView = async (
  day: DailyRecord,
  reloadDay: () => Promise<DailyRecord | null>,
  clinicalEpisodeId?: string
): Promise<ClinicalFillDerivedView> => {
  if (day.clinicalDerivedLayout == null) return { record: day, day };
  const { readDailyRecordWithClinicalDerived } =
    await import('@/services/repositories/dailyRecordClinicalDerivedReadService');
  const view = await readDailyRecordWithClinicalDerived(day, {
    mode: 'strict',
    clinicalEpisodeId,
    reloadRecord: reloadDay,
  });
  return { record: view.record, day: view.day };
};
