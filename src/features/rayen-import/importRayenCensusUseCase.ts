/**
 * Use-case: plan a Rayen → HHR census import.
 *
 * Phase 1 is preview-only: it computes the `CensusImportDiff` the user reviews and
 * confirms. It performs NO persistence. Applying the confirmed diff (through the
 * DailyRecord repository + CensusManager) is Phase 2.
 */

import type { DailyRecord } from './contracts/rayenDomainContracts';
import type { RayenCensusSnapshot } from './contracts/rayenSnapshot';
import type { CensusImportDiff } from './contracts/censusImportDiff';
import { reconcileCensus } from './domain/reconcileCensus';

export interface PlanRayenCensusImportInput {
  /** The HHR daily record the snapshot will be reconciled against (usually today). */
  current: DailyRecord;
  /** The census snapshot captured from Rayen by the extension. */
  snapshot: RayenCensusSnapshot;
  /** Reference date for age computation (defaults to now). */
  reference?: Date;
}

export interface PlanRayenCensusImportResult {
  diff: CensusImportDiff;
}

export const planRayenCensusImport = (
  input: PlanRayenCensusImportInput
): PlanRayenCensusImportResult => ({
  diff: reconcileCensus(input.current, input.snapshot, { reference: input.reference }),
});
