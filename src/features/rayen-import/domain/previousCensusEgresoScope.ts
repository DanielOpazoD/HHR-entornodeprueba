import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';

/** Preserves the D-1 clinical-crib scope after an exact row becomes a report-only egreso. */
export const applyPreviousCensusEgresoScope = (
  diff: CensusImportDiff,
  rows: readonly EgresoReportRow[]
): CensusImportDiff => {
  const cribEpisodes = new Set(
    rows
      .filter(row => row.fromClinicalCrib)
      .map(row => row.encounterId?.trim())
      .filter((episode): episode is string => Boolean(episode))
  );
  if (cribEpisodes.size === 0 || !diff.reportEgresos?.length) return diff;
  return {
    ...diff,
    reportEgresos: diff.reportEgresos.map(egreso =>
      egreso.encounterId && cribEpisodes.has(egreso.encounterId)
        ? { ...egreso, fromClinicalCrib: true }
        : egreso
    ),
  };
};
