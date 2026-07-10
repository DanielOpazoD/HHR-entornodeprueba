/**
 * Enriches a `CensusImportDiff` with gestión de camas egreso lookups (Fase B).
 *
 * A patient present in HHR but absent from Ficha Médico is reconciled as a `missing-in-rayen`
 * discharge — inferred, review-gated, generic 'alta'. When the sync also queries gestión de
 * camas (by RUN) and finds the real egreso, that inferred discharge is upgraded to a
 * confirmed 'rayen-discharge' with the correct kind (alta / traslado / cma) and status.
 * This is what closes the "late sync" gap. Pure and deterministic.
 */

import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoLookupResult } from '../contracts/egresoLookup';
import { mapEgresoToDischarge } from '../mapping/egresoDischargeMapping';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/** RUNs of the inferred (missing-in-rayen) discharges that a gestión de camas lookup could confirm. */
export const runsNeedingEgresoLookup = (diff: CensusImportDiff): string[] =>
  diff.discharges
    .filter(discharge => discharge.reason === 'missing-in-rayen')
    .map(discharge => discharge.rut)
    .filter((rut): rut is string => !!rut && rut.trim().length > 0);

export const applyEgresoLookups = (
  diff: CensusImportDiff,
  results: EgresoLookupResult[]
): CensusImportDiff => {
  const byRun = new Map<string, NonNullable<EgresoLookupResult['egreso']>>();
  for (const result of results) {
    if (result.egreso) byRun.set(normalizeRut(result.run), result.egreso);
  }
  if (byRun.size === 0) return diff;

  const discharges = diff.discharges.map(discharge => {
    if (discharge.reason !== 'missing-in-rayen') return discharge;
    const egreso = byRun.get(normalizeRut(discharge.rut));
    if (!egreso) return discharge; // not confirmed → stays inferred, review-gated
    const mapped = mapEgresoToDischarge(egreso);
    return {
      ...discharge,
      kind: mapped.kind,
      status: mapped.status,
      reason: 'rayen-discharge' as const,
    };
  });

  return { ...diff, discharges };
};
