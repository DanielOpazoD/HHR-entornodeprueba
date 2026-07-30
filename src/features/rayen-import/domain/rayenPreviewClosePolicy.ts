import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { ApplyResult } from './applyCensusImportDiff';

export const hasApplicableCensusChanges = (diff: CensusImportDiff | null): boolean =>
  Boolean(
    diff &&
    diff.admissions.length +
      diff.updates.length +
      diff.moves.length +
      diff.discharges.length +
      (diff.previousDayAdmissionCandidates?.length ?? 0) +
      (diff.previousDayEdits?.length ?? 0) +
      (diff.reportEgresos?.length ?? 0) >
      0
  );

/** Closing an already-applied or conflict-only review must not cancel its detached clinical fill. */
export const shouldPreservePostImportFlow = (
  diff: CensusImportDiff | null,
  result: ApplyResult | null
): boolean => Boolean(result) || Boolean(diff && !hasApplicableCensusChanges(diff));
