import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import { isSameForeignDocument, normalizeRut } from '@/utils/rutUtils';

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
            (entry.documentType === 'Pasaporte'
              ? isSameForeignDocument(result.run, entry.rut)
              : normalizeRut(result.run) === normalizeRut(String(entry.rut)))
        )
    )
    .map(entry => ({
      run: entry.rut,
      encounterId: entry.encounterId as string,
      ...(entry.documentType === 'Pasaporte' ? { documentType: 'Pasaporte' as const } : {}),
    }));
