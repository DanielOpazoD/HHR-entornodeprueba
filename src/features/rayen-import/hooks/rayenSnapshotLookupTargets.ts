import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import { normalizeRut } from '@/utils/rutUtils';

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
            normalizeRut(result.run) === normalizeRut(String(entry.rut))
        )
    )
    .map(entry => ({ run: entry.rut, encounterId: entry.encounterId as string }));
