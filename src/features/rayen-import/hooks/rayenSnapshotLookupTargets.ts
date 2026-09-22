import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import { officialPatientTypedIdentitiesEqual } from '../domain/officialPatientIdentifier';

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
            officialPatientTypedIdentitiesEqual(
              result.run,
              result.documentType,
              entry.rut,
              entry.documentType
            )
        )
    )
    .map(entry => ({
      run: entry.rut,
      documentType: entry.documentType,
      encounterId: entry.encounterId as string,
    }));
