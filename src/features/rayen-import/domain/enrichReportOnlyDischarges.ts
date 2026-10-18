import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { isPassportFormat, normalizeRut } from '@/utils/rutUtils';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import { parseStatisticalDischargeEvidence } from '../mapping/parseStatisticalDischargeReport';
import { parseStatisticalEgresoInstant } from '../mapping/reportEgresoDateTime';
import { correctedStamp } from './egresoReportPolicy';
import { decodePdfBase64 } from './historicalStatisticalDischargeRecovery';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';
import {
  recoverHistoricalReportEpisodes,
  type HistoricalReportEpisodeDependencies,
} from './historicalReportEpisodeRecovery';
import {
  previousCensusEgresoIdentity,
  previousCensusEgresoRowIdentity,
  type PreviousCensusEgresoCandidate,
} from './previousCensusEgresoCandidates';

interface ReportOnlyDischargeDependencies {
  lookupEgresos: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
  fetchStatisticalDischarge: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText?: (buffer: ArrayBuffer) => Promise<string>;
  /**
   * Fila cuyo egreso ya está aplicado en HHR: se salta la verificación cara
   * (lookup + PDF) — la elegibilidad la descarta de todos modos como historia.
   */
  alreadyApplied?: (
    row: EgresoReportRow,
    exactCandidate?: PreviousCensusEgresoCandidate
  ) => boolean;
  /** Exact D-1 episodes that can disambiguate mother/newborn rows sharing maternal RUN + day. */
  previousCensusCandidates?: readonly PreviousCensusEgresoCandidate[];
  /** Historical reconstruction also needs episodes discharged after the requested cutoff. */
  allReportDays?: boolean;
  lookupHospitalizations?: HistoricalReportEpisodeDependencies['lookupHospitalizations'];
}

const exactDay = (timestamp: string): string => timestamp.slice(0, 10);
const exactTime = (timestamp: string): string => timestamp.slice(11, 16);
const censusDay = (timestamp: string): string | undefined =>
  resolveClinicalDayForDateTime(exactDay(timestamp), exactTime(timestamp));

// Jasper repeats one administrative event for each principal diagnosis. This only groups
// lookup work: a unique source episode and the official PDF must still verify every row.
const sameDischargeEvent = (left: EgresoReportRow, right: EgresoReportRow): boolean =>
  (
    [
      'run',
      'patientName',
      'bedLabel',
      'servicio',
      'edad',
      'destino',
      'motivo',
      'fechaEgreso',
      'encounterId',
      'correctedDay',
      'correctedTime',
      'admissionDay',
      'admissionTime',
      'dischargeStatus',
      'fromClinicalCrib',
    ] as const
  ).every(key => left[key] === right[key]);

/**
 * Resolves report-only discharges to an exact episode and replaces the bulk report's shifted
 * timestamp with the official admission/discharge interval. The bulk report is discovery only.
 * A uniquely identified D-1 occupant may also use an exact episode lookup when a neonatal PDF uses
 * the alternate maternal-identifier layout; every other ambiguous or mismatching row stays blocked.
 */
const enrichFromGestionCamas = async (
  rows: readonly EgresoReportRow[],
  reportDate: string,
  dependencies: ReportOnlyDischargeDependencies
): Promise<EgresoReportRow[]> => {
  const rowKey = (row: EgresoReportRow): string => {
    if (row.encounterId || isPavilionRecoveryLocation(row.bedLabel) || isPassportFormat(row.run))
      return '';
    const run = normalizeRut(row.run);
    const { correctedDay } = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
    return run && correctedDay && (dependencies.allReportDays || correctedDay === reportDate)
      ? `${run}|${correctedDay}`
      : '';
  };
  const exactCandidatesByIdentity = new Map(
    (dependencies.previousCensusCandidates ?? []).map(candidate => [
      previousCensusEgresoIdentity(
        candidate.run,
        candidate.patientName,
        candidate.dischargeDay ?? reportDate
      ),
      candidate,
    ])
  );
  const exactCandidateByRow = new Map<EgresoReportRow, PreviousCensusEgresoCandidate>();
  for (const row of rows) {
    if (isPassportFormat(row.run)) continue;
    const identity = previousCensusEgresoRowIdentity(row);
    const candidate = exactCandidatesByIdentity.get(identity);
    if (candidate && !row.encounterId && !dependencies.alreadyApplied?.(row, candidate)) {
      exactCandidateByRow.set(row, candidate);
    }
  }

  const keys = new Map<string, EgresoReportRow>();
  const ambiguousKeys = new Set<string>();
  for (const row of rows) {
    if (exactCandidateByRow.has(row)) continue;
    const key = rowKey(row);
    if (!key || ambiguousKeys.has(key) || dependencies.alreadyApplied?.(row)) continue;
    if (keys.has(key) && !sameDischargeEvent(keys.get(key)!, row)) {
      keys.delete(key);
      ambiguousKeys.add(key);
    } else {
      keys.set(key, row);
    }
  }
  const enrichedByKey = new Map<string, EgresoReportRow>();
  const enrichedByRow = new Map<EgresoReportRow, EgresoReportRow>();
  const withVerificationState = (row: EgresoReportRow): EgresoReportRow => {
    if (exactCandidateByRow.has(row)) {
      return enrichedByRow.get(row) ?? { ...row, exactEpisodeVerification: 'unverified' };
    }
    const key = rowKey(row);
    if (!key) return row;
    const enriched = enrichedByKey.get(key);
    return enriched
      ? { ...enriched, diagnostico: row.diagnostico }
      : { ...row, exactEpisodeVerification: 'unverified' };
  };

  const keyedTargets = [...keys.entries()].map(([key, row]) => ({
    key,
    row,
    target: {
      run: row.run,
      encounterId: '',
      dischargeDay: key.split('|')[1],
    },
  }));
  const exactTargets = [...exactCandidateByRow.entries()].map(([row, candidate]) => ({
    key: `episode:${candidate.encounterId}`,
    row,
    target: candidate,
  }));
  const targets = [...keyedTargets, ...exactTargets];
  if (targets.length === 0) return rows.map(withVerificationState);

  let lookupResults: EgresoLookupResult[];
  try {
    lookupResults = (await dependencies.lookupEgresos(targets.map(item => item.target))) ?? [];
  } catch {
    return rows.map(withVerificationState);
  }
  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  await Promise.all(
    targets.map(async ({ key, row, target }, index) => {
      const lookup = target.encounterId
        ? lookupResults.find(
            result =>
              String(result.encounterId ?? '').trim() === target.encounterId &&
              normalizeRut(result.run) === normalizeRut(target.run)
          )
        : lookupResults[index];
      const encounterId = String(lookup?.encounterId ?? '').trim();
      if (!/^\d+$/.test(encounterId) || !lookup?.egreso || lookup.error) return;
      const metadataEpisode = String(lookup.egreso.id ?? lookup.egreso.encounterId ?? '').trim();
      if (
        target.encounterId &&
        (lookup.egreso.hasAdministrativeDischarge === false ||
          (metadataEpisode &&
            metadataEpisode.replace(/^0+(?=\d)/, '') !==
              target.encounterId.replace(/^0+(?=\d)/, '')))
      ) {
        return;
      }
      try {
        const report = await dependencies.fetchStatisticalDischarge(encounterId);
        if (!report.base64 || report.error) return;
        const evidence = parseStatisticalDischargeEvidence(
          await extractText(decodePdfBase64(report.base64)),
          { allowMaternalIdentifier: 'fromClinicalCrib' in target && target.fromClinicalCrib }
        );
        if (
          'personalRun' in target &&
          target.personalRun === '' &&
          evidence?.identifierKind !== 'maternal'
        )
          return;
        if (
          evidence &&
          (evidence.run !== normalizeRut(row.run) ||
            censusDay(evidence.dischargeAt) !== target.dischargeDay)
        ) {
          return;
        }
        // The lookup selector guarantees RUN + episode; the guard above verifies metadata/status.
        const lookupStamp =
          !evidence && target.encounterId
            ? parseStatisticalEgresoInstant(
                String(lookup.egreso.dateDischarge ?? lookup.egreso.endPeriod ?? '').trim()
              )
            : null;
        if (!evidence && (!lookupStamp || lookupStamp.iso !== target.dischargeDay)) return;
        const enriched = {
          ...row,
          ...('personalRun' in target ? { run: target.personalRun ?? '' } : {}),
          encounterId,
          exactEpisodeVerification: 'verified' as const,
          ...(evidence
            ? {
                admissionDay: exactDay(evidence.admissionAt),
                admissionTime: exactTime(evidence.admissionAt),
                correctedDay: censusDay(evidence.dischargeAt),
                correctedTime: exactTime(evidence.dischargeAt),
              }
            : lookupStamp
              ? { correctedDay: lookupStamp.iso, correctedTime: lookupStamp.hhmm }
              : {}),
          ...('fromClinicalCrib' in target && target.fromClinicalCrib
            ? { fromClinicalCrib: true }
            : {}),
          ...(evidence?.isDead === undefined
            ? {}
            : { dischargeStatus: evidence.isDead ? ('Fallecido' as const) : ('Vivo' as const) }),
        };
        if (target.encounterId) enrichedByRow.set(row, enriched);
        else enrichedByKey.set(key, enriched);
      } catch {
        // Preserve discovery evidence, but never let it mutate an episode without exact proof.
      }
    })
  );

  return rows.map(withVerificationState);
};

export const enrichReportOnlyDischarges = async (
  rows: readonly EgresoReportRow[],
  reportDate: string,
  dependencies: ReportOnlyDischargeDependencies
): Promise<EgresoReportRow[]> => {
  const enriched = await enrichFromGestionCamas(rows, reportDate, dependencies);
  return dependencies.allReportDays && dependencies.lookupHospitalizations
    ? recoverHistoricalReportEpisodes(enriched, reportDate, {
        ...dependencies,
        lookupHospitalizations: dependencies.lookupHospitalizations,
        extractText: dependencies.extractText ?? extractPdfTextFromBuffer,
      })
    : enriched;
};
