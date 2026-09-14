import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { normalizeRut } from '@/utils/rutUtils';
import type {
  EgresoLookupResult,
  EgresoLookupTarget,
  EgresoRecord,
} from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import { parseStatisticalDischargeEvidence } from '../mapping/parseStatisticalDischargeReport';
import { parseStatisticalEgresoInstant } from '../mapping/reportEgresoDateTime';
import { correctedStamp } from './egresoReportPolicy';
import { decodePdfBase64 } from './historicalStatisticalDischargeRecovery';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';
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
}

const exactDay = (timestamp: string): string => timestamp.slice(0, 10);
const exactTime = (timestamp: string): string => timestamp.slice(11, 16);

const exactLookupDischargeStamp = (egreso: EgresoRecord) => {
  if (egreso.hasAdministrativeDischarge === false) return null;
  const raw = String(egreso.dateDischarge ?? egreso.endPeriod ?? '').trim();
  return parseStatisticalEgresoInstant(raw);
};

const exactLookupMatches = (
  lookup: EgresoLookupResult,
  target: EgresoLookupTarget,
  dischargeDay: string
): boolean => {
  if (normalizeRut(lookup.run) !== normalizeRut(target.run)) return false;
  const requestedEpisode = target.encounterId.trim();
  const returnedEpisode = String(lookup.encounterId ?? '').trim();
  if (!requestedEpisode || returnedEpisode !== requestedEpisode) return false;
  const metadataEpisode = String(lookup.egreso?.id ?? lookup.egreso?.encounterId ?? '').trim();
  if (
    metadataEpisode &&
    metadataEpisode.replace(/^0+(?=\d)/, '') !== requestedEpisode.replace(/^0+(?=\d)/, '')
  ) {
    return false;
  }
  return Boolean(lookup.egreso && exactLookupDischargeStamp(lookup.egreso)?.iso === dischargeDay);
};

const candidateKey = (row: EgresoReportRow, reportDate: string): string => {
  if (row.encounterId || isPavilionRecoveryLocation(row.bedLabel)) return '';
  const run = normalizeRut(row.run);
  const stamp = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
  return run && stamp.correctedDay === reportDate ? `${run}|${reportDate}` : '';
};

/**
 * Resolves report-only discharges to an exact episode and replaces the bulk report's shifted
 * timestamp with the official admission/discharge interval. The bulk report is discovery only.
 * A uniquely identified D-1 occupant may also use an exact episode lookup when a neonatal PDF uses
 * the alternate maternal-identifier layout; every other ambiguous or mismatching row stays blocked.
 */
export const enrichReportOnlyDischarges = async (
  rows: readonly EgresoReportRow[],
  reportDate: string,
  dependencies: ReportOnlyDischargeDependencies
): Promise<EgresoReportRow[]> => {
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
    const key = candidateKey(row, reportDate);
    if (!key || ambiguousKeys.has(key) || dependencies.alreadyApplied?.(row)) continue;
    if (keys.has(key)) {
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
    const key = candidateKey(row, reportDate);
    if (!key) return row;
    return enrichedByKey.get(key) ?? { ...row, exactEpisodeVerification: 'unverified' };
  };

  const keyedTargets = [...keys.entries()].map(([key, row]) => ({
    key,
    row,
    target: { run: row.run, encounterId: '', dischargeDay: reportDate },
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
      if (
        !/^\d+$/.test(encounterId) ||
        (target.encounterId && encounterId !== target.encounterId) ||
        !lookup?.egreso ||
        lookup.error
      )
        return;
      const metadataEpisode = String(lookup.egreso.id ?? lookup.egreso.encounterId ?? '').trim();
      if (
        target.encounterId &&
        (normalizeRut(lookup.run) !== normalizeRut(target.run) ||
          lookup.egreso.hasAdministrativeDischarge === false ||
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
          await extractText(decodePdfBase64(report.base64))
        );
        if (
          evidence &&
          (evidence.run !== normalizeRut(row.run) ||
            exactDay(evidence.dischargeAt) !== target.dischargeDay)
        ) {
          return;
        }
        const exactPdf = evidence;
        const exactPreviousCensusLookup =
          !evidence &&
          Boolean(target.encounterId) &&
          exactLookupMatches(lookup, target, target.dischargeDay ?? '');
        if (!exactPdf && !exactPreviousCensusLookup) return;
        const lookupStamp = exactPreviousCensusLookup
          ? exactLookupDischargeStamp(lookup.egreso)
          : null;
        const enriched = {
          ...row,
          encounterId,
          exactEpisodeVerification: 'verified' as const,
          ...(exactPdf
            ? {
                admissionDay: exactDay(exactPdf.admissionAt),
                admissionTime: exactTime(exactPdf.admissionAt),
                correctedDay: exactDay(exactPdf.dischargeAt),
                correctedTime: exactTime(exactPdf.dischargeAt),
              }
            : lookupStamp
              ? { correctedDay: lookupStamp.iso, correctedTime: lookupStamp.hhmm }
              : {}),
          ...('fromClinicalCrib' in target && target.fromClinicalCrib
            ? { fromClinicalCrib: true }
            : {}),
          ...(exactPdf?.isDead === undefined
            ? {}
            : { dischargeStatus: exactPdf.isDead ? ('Fallecido' as const) : ('Vivo' as const) }),
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
