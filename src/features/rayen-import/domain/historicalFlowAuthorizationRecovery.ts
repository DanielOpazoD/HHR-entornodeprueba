import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import { decodeClinicalReadFailure } from '../contracts/clinicalReadError';
import type { RayenEncounter } from '../contracts/rayenSnapshot';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';

/** A lost MV3 lease may be renewed once through exact source identity; never locally grant access. */
export const readHistoricalPatientFlow = async (
  encounter: RayenEncounter,
  dependencies: {
    fetchReport: (episode: string) => Promise<PatientFlowReportResult>;
    lookupEgresos?: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
  }
): Promise<PatientFlowReportResult> => {
  const first = await dependencies.fetchReport(encounter.encounterId);
  if (
    decodeClinicalReadFailure(first).errorCode !== 'episode_not_authorized' ||
    !dependencies.lookupEgresos ||
    !/^\d+$/.test(encounter.encounterId) ||
    !isValidRut(encounter.run)
  )
    return first;
  try {
    const results = await dependencies.lookupEgresos([
      { run: encounter.run, encounterId: encounter.encounterId },
    ]);
    const exact = results.filter(
      result =>
        !result.error &&
        result.egreso &&
        result.encounterId === encounter.encounterId &&
        normalizeRut(result.run) === normalizeRut(encounter.run) &&
        [result.egreso.id, result.egreso.encounterId].some(value => value != null) &&
        [result.egreso.id, result.egreso.encounterId]
          .filter(value => value != null)
          .every(value => String(value) === encounter.encounterId)
    );
    if (exact.length !== 1) return first;
    return dependencies.fetchReport(encounter.encounterId);
  } catch {
    return first;
  }
};
