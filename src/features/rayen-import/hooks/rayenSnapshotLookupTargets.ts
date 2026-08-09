import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';

const normalizeRun = (value: string): string =>
  value.replace(/[^0-9kK]/gi, '').toUpperCase();

export const collectEgresoLookupTargets = (
  diff: CensusImportDiff,
  existingResults: EgresoLookupResult[] = []
) =>
  diff.pendingAdministrativeDischarges
    .filter(entry => entry.rut && entry.encounterId)
    .filter(
      entry =>
        !existingResults.some(
          result =>
            result.encounterId === entry.encounterId &&
            normalizeRun(result.run) === normalizeRun(String(entry.rut))
        )
    )
    .map(entry => ({ run: entry.rut, encounterId: entry.encounterId as string }));
