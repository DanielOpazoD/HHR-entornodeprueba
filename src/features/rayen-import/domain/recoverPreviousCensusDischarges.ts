import { normalizeRut } from '@/utils/rutUtils';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import { parseStatisticalEgresoInstant } from '../mapping/reportEgresoDateTime';
import { reportRowFromLookup } from './applyEgresoLookupFallback';
import { previousCensusDate, unexplainedPreviousCensusOccupants } from './previousCensusContinuity';

/**
 * A manually cleared bed is no longer a lookup target of the current census. Investigate
 * unexplained D-1 episodes even when neither live source nor the bulk report lists them.
 * Absence only triggers a read: exact identity, explicit administrative closure and an
 * official island timestamp are mandatory before producing a reviewable movement.
 */
export const recoverPreviousCensusDischarges = async (
  previous: DailyRecord | null | undefined,
  current: DailyRecord,
  diff: CensusImportDiff,
  snapshot: RayenCensusSnapshot,
  lookup: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>
): Promise<EgresoReportRow[]> => {
  if (!previous || previous.date !== previousCensusDate(current.date)) return [];
  const liveEpisodes = new Set(snapshot.encounters.map(encounter => encounter.encounterId));
  const missing = unexplainedPreviousCensusOccupants(previous, current, diff).filter(
    patient =>
      /^\d+$/.test(patient.clinicalEpisodeId ?? '') &&
      normalizeRut(patient.rut) &&
      !liveEpisodes.has(patient.clinicalEpisodeId!)
  );
  // Duplicate local identities are not sufficient to choose principal versus newborn scope.
  const candidates = missing.filter(
    patient =>
      missing.filter(other => other.clinicalEpisodeId === patient.clinicalEpisodeId).length === 1
  );
  if (candidates.length === 0) return [];
  let results: EgresoLookupResult[];
  try {
    results = await lookup(
      candidates.map(patient => ({
        run: patient.rut!,
        encounterId: patient.clinicalEpisodeId!,
      }))
    );
  } catch {
    return []; // The ordinary continuity conflict remains actionable and retryable.
  }
  return candidates.flatMap(patient => {
    const matches = results.filter(
      result =>
        result.encounterId === patient.clinicalEpisodeId &&
        normalizeRut(result.run) === normalizeRut(patient.rut)
    );
    if (matches.length !== 1) return [];
    const result = matches[0];
    const egreso = result.egreso;
    if (result.error || !egreso || egreso.hasAdministrativeDischarge !== true) return [];
    for (const id of [egreso.id, egreso.encounterId]) {
      if (
        id != null &&
        String(id)
          .trim()
          .replace(/^0+(?=\d)/, '') !== patient.clinicalEpisodeId
      ) {
        return [];
      }
    }
    const stamp = parseStatisticalEgresoInstant(
      String(egreso.dateDischarge || egreso.endPeriod || '')
    );
    if (!stamp || stamp.iso < previous.date || stamp.iso > current.date) return [];
    const admission = patient.admissionDate?.slice(0, 10);
    if (
      admission &&
      (stamp.calendarIso < admission ||
        (stamp.calendarIso === admission &&
          patient.admissionTime &&
          stamp.hhmm < patient.admissionTime))
    ) {
      return [];
    }
    const bedId = patient.bedId!;
    const stored =
      patient.scope === 'crib' ? previous.beds[bedId]?.clinicalCrib : previous.beds[bedId];
    return [
      {
        ...reportRowFromLookup(result, { patientName: patient.patientName ?? '', bedId }),
        exactEpisodeVerification: 'verified' as const,
        correctedDay: stamp.iso,
        correctedTime: stamp.hhmm,
        admissionDay: admission,
        admissionTime: patient.admissionTime,
        diagnostico: stored?.pathology,
        servicio: stored?.specialty ?? '',
        edad: stored?.age ?? '',
        fromClinicalCrib: patient.scope === 'crib',
      },
    ];
  });
};
