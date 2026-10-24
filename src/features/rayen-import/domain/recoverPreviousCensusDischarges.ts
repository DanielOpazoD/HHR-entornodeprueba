import { isValidRut } from '@/utils/rutUtils';
import { normalizePatientRut as normalizeRut } from './censusPatientIdentityIndex';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import { parseStatisticalEgresoInstant } from '../mapping/reportEgresoDateTime';
import { reportRowFromLookup } from './applyEgresoLookupFallback';
import { previousCensusDate, unexplainedPreviousCensusOccupants } from './previousCensusContinuity';
import { neonatalMaternalLookupRut } from './neonatalMaternalLookupIdentity';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import { parseStatisticalDischargeEvidence } from '../mapping/parseStatisticalDischargeReport';
import { decodePdfBase64 } from './historicalStatisticalDischargeRecovery';
import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';

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
  lookup: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>,
  documents?: {
    fetchStatisticalDischarge: (episode: string) => Promise<PatientFlowReportResult>;
    extractText?: (buffer: ArrayBuffer) => Promise<string>;
  }
): Promise<EgresoReportRow[]> => {
  if (!previous || previous.date !== previousCensusDate(current.date)) return [];
  const liveEpisodes = new Set(snapshot.encounters.map(encounter => encounter.encounterId));
  const missing = unexplainedPreviousCensusOccupants(previous, current, diff).filter(
    patient =>
      /^\d+$/.test(patient.clinicalEpisodeId ?? '') && !liveEpisodes.has(patient.clinicalEpisodeId!)
  );
  // Duplicate local identities are not sufficient to choose principal versus newborn scope.
  const candidates = missing.flatMap(patient => {
    if (missing.filter(other => other.clinicalEpisodeId === patient.clinicalEpisodeId).length !== 1)
      return [];
    // The stored nested relation identifies the mother; the bed number alone never does.
    const mother = patient.scope === 'crib' ? previous.beds[patient.bedId!] : undefined;
    const lookupRun = normalizeRut(patient.rut)
      ? patient.rut
      : isValidRut(patient.neonatalMaternalRut ?? '')
        ? patient.neonatalMaternalRut
        : mother &&
          neonatalMaternalLookupRut(
            previous,
            snapshot.encounters,
            patient.clinicalEpisodeId!,
            mother.rut
          );
    return lookupRun ? [{ patient, lookupRun }] : [];
  });
  if (candidates.length === 0) return [];
  let results: EgresoLookupResult[];
  try {
    results = await lookup(
      candidates.map(({ patient, lookupRun }) => ({
        run: lookupRun,
        encounterId: patient.clinicalEpisodeId!,
      }))
    );
  } catch {
    return []; // The ordinary continuity conflict remains actionable and retryable.
  }
  const recovered = await Promise.all(
    candidates.map(async ({ patient, lookupRun }): Promise<EgresoReportRow[]> => {
      const matches = results.filter(
        result =>
          result.encounterId === patient.clinicalEpisodeId &&
          normalizeRut(result.run) === normalizeRut(lookupRun)
      );
      if (matches.length !== 1) return [];
      const result = matches[0];
      const egreso = result.egreso;
      if (
        result.error ||
        !egreso ||
        egreso.hasAdministrativeDischarge === false ||
        (egreso.hasAdministrativeDischarge !== true &&
          !egreso.dateDischarge &&
          !(documents && !normalizeRut(patient.rut)))
      )
        return [];
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
      let stamp = parseStatisticalEgresoInstant(
        String(egreso.dateDischarge || egreso.endPeriod || '')
      );
      // Maternal identifiers use the neonatal document layout. Its local clock is authoritative;
      // the API timestamp has previously differed from the actual printed discharge time.
      if (!normalizeRut(patient.rut)) {
        if (!documents) return [];
        try {
          const report = await documents.fetchStatisticalDischarge(patient.clinicalEpisodeId!);
          if (!report.base64 || report.error) return [];
          const evidence = parseStatisticalDischargeEvidence(
            await (documents.extractText ?? extractPdfTextFromBuffer)(
              decodePdfBase64(report.base64)
            ),
            { allowMaternalIdentifier: true }
          );
          if (
            !evidence ||
            evidence.identifierKind !== 'maternal' ||
            evidence.run !== normalizeRut(lookupRun)
          )
            return [];
          // clinical-clock-allow instant-calendar-slice: Parsed report dischargeAt is unzoned hospital wall time; preserve its official calendar day.
          const calendarIso = evidence.dischargeAt.slice(0, 10);
          const hhmm = evidence.dischargeAt.slice(11, 16);
          const iso = resolveClinicalDayForDateTime(calendarIso, hhmm) ?? calendarIso;
          stamp = { iso, calendarIso, hhmm, text: evidence.dischargeAt };
          // clinical-clock-allow instant-calendar-slice: Parsed report admissionAt is unzoned hospital wall time, compared to the stored admission calendar date.
          if (patient.admissionDate?.slice(0, 10) !== evidence.admissionAt.slice(0, 10)) return [];
        } catch {
          return [];
        }
      }
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
          // A lookup through the mother must never become the newborn's personal document.
          run: patient.rut ?? '',
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
    })
  );
  return recovered.flat();
};
