import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { normalizeRut } from '@/utils/rutUtils';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import { parseStatisticalDischargeEvidence } from '../mapping/parseStatisticalDischargeReport';
import { correctedStamp } from './egresoReportPolicy';
import { decodePdfBase64 } from './historicalStatisticalDischargeRecovery';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';

interface ReportOnlyDischargeDependencies {
  lookupEgresos: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
  fetchStatisticalDischarge: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText?: (buffer: ArrayBuffer) => Promise<string>;
  /**
   * Fila cuyo egreso ya está aplicado en HHR: se salta la verificación cara
   * (lookup + PDF) — la elegibilidad la descarta de todos modos como historia.
   */
  alreadyApplied?: (row: EgresoReportRow) => boolean;
}

const exactDay = (timestamp: string): string => timestamp.slice(0, 10);
const exactTime = (timestamp: string): string => timestamp.slice(11, 16);

const candidateKey = (row: EgresoReportRow, reportDate: string): string => {
  if (row.encounterId || isPavilionRecoveryLocation(row.bedLabel)) return '';
  const run = normalizeRut(row.run);
  const stamp = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
  return run && stamp.correctedDay === reportDate ? `${run}|${reportDate}` : '';
};

/**
 * Resolves report-only discharges to an exact episode and replaces the bulk report's shifted
 * timestamp with the official admission/discharge interval. The bulk report is discovery only:
 * ambiguous lookups or mismatching PDFs remain visible but are explicitly marked non-actionable.
 */
export const enrichReportOnlyDischarges = async (
  rows: readonly EgresoReportRow[],
  reportDate: string,
  dependencies: ReportOnlyDischargeDependencies
): Promise<EgresoReportRow[]> => {
  const keys = new Map<string, EgresoReportRow>();
  const ambiguousKeys = new Set<string>();
  for (const row of rows) {
    const key = candidateKey(row, reportDate);
    if (!key || ambiguousKeys.has(key) || dependencies.alreadyApplied?.(row)) continue;
    if (keys.has(key)) {
      keys.delete(key);
      ambiguousKeys.add(key);
    } else {
      keys.set(key, row);
    }
  }
  const withVerificationState = (row: EgresoReportRow): EgresoReportRow => {
    const key = candidateKey(row, reportDate);
    if (!key) return row;
    return enrichedByKey.get(key) ?? { ...row, exactEpisodeVerification: 'unverified' };
  };

  const enrichedByKey = new Map<string, EgresoReportRow>();
  if (keys.size === 0) return rows.map(withVerificationState);

  let lookupResults: EgresoLookupResult[];
  try {
    lookupResults =
      (await dependencies.lookupEgresos(
        [...keys.keys()].map(key => ({
          run: keys.get(key)?.run ?? '',
          encounterId: '',
          dischargeDay: reportDate,
        }))
      )) ?? [];
  } catch {
    return rows.map(withVerificationState);
  }
  const lookupByKey = new Map(
    lookupResults.map(result => [`${normalizeRut(result.run)}|${reportDate}`, result])
  );
  const extractText = dependencies.extractText ?? extractPdfTextFromBuffer;
  await Promise.all(
    [...keys.entries()].map(async ([key, row]) => {
      const lookup = lookupByKey.get(key);
      const encounterId = String(lookup?.encounterId ?? '').trim();
      if (!/^\d+$/.test(encounterId) || !lookup?.egreso || lookup.error) return;
      try {
        const report = await dependencies.fetchStatisticalDischarge(encounterId);
        if (!report.base64 || report.error) return;
        const evidence = parseStatisticalDischargeEvidence(
          await extractText(decodePdfBase64(report.base64))
        );
        if (
          !evidence ||
          evidence.run !== normalizeRut(row.run) ||
          exactDay(evidence.dischargeAt) !== reportDate
        ) {
          return;
        }
        enrichedByKey.set(key, {
          ...row,
          encounterId,
          exactEpisodeVerification: 'verified',
          admissionDay: exactDay(evidence.admissionAt),
          admissionTime: exactTime(evidence.admissionAt),
          correctedDay: exactDay(evidence.dischargeAt),
          correctedTime: exactTime(evidence.dischargeAt),
          ...(evidence.isDead === undefined
            ? {}
            : { dischargeStatus: evidence.isDead ? ('Fallecido' as const) : ('Vivo' as const) }),
        });
      } catch {
        // Preserve discovery evidence, but never let it mutate an episode without exact proof.
      }
    })
  );

  return rows.map(withVerificationState);
};
