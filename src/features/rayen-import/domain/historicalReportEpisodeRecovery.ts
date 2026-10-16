import { isPassportFormat, normalizeRut } from '@/utils/rutUtils';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import type { RayenHospitalizationReportResult } from '../bridge/hospitalizationReportsBridge';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { PatientFlowReportResult } from '../bedTraceabilityResolver';
import { parseStatisticalDischargeEvidence } from '../mapping/parseStatisticalDischargeReport';
import { censusNightCloseTimestamp, toIsoCensusDay } from './censusDayPolicy';
import { previousCensusEgresoIdentity } from './previousCensusEgresoCandidates';
import { decodePdfBase64 } from './historicalStatisticalDischargeRecovery';

export interface HistoricalReportEpisodeDependencies {
  lookupHospitalizations: (run: string) => Promise<RayenHospitalizationReportResult>;
  lookupEgresos: (targets: EgresoLookupTarget[]) => Promise<EgresoLookupResult[]>;
  fetchStatisticalDischarge: (encounterId: string) => Promise<PatientFlowReportResult>;
  extractText: (buffer: ArrayBuffer) => Promise<string>;
}

const validDay = (value: string | undefined): value is string =>
  !!value &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * A bulk administrative range discovers episodes; it does not prove presence on the chosen day.
 * Resolve a row only through one exact RUN + full name + calendar discharge-date match. Unknown
 * or legacy index metadata keeps the row in review. The index never supplies a historical bed.
 */
export const recoverHistoricalReportEpisodes = async (
  rows: readonly EgresoReportRow[],
  censusDate: string,
  dependencies: HistoricalReportEpisodeDependencies
): Promise<EgresoReportRow[]> => {
  const cutoff = censusNightCloseTimestamp(censusDate);
  const indexCache = new Map<string, Promise<RayenHospitalizationReportResult>>();
  const readIndex = (run: string) => {
    const key = normalizeRut(run);
    let pending = indexCache.get(key);
    if (!pending) {
      pending = dependencies.lookupHospitalizations(run).catch(() => ({ ok: false }));
      indexCache.set(key, pending);
    }
    return pending;
  };
  const recover = async (row: EgresoReportRow): Promise<EgresoReportRow | null> => {
    if (row.encounterId || isPassportFormat(row.run)) return row;
    const cribLabel = row.bedLabel.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // Guard only: a source crib label never identifies its mother or supplies a parent bed.
    const isClinicalCrib =
      row.fromClinicalCrib || /^(?:CUNA|C(?:R[1-4]|H[1-6]C[12]|NEO[12])$)/.test(cribLabel);
    const reportDay = toIsoCensusDay(row.fechaEgreso);
    if (!validDay(reportDay)) return row;
    const index = await readIndex(row.run);
    if (!index.ok || !index.episodes) return row;
    const identity = previousCensusEgresoIdentity(row.run, row.patientName, reportDay);
    const matches = index.episodes.filter(
      episode =>
        /^\d+$/.test(episode.encId) &&
        episode.endDate === reportDay &&
        validDay(episode.startDate) &&
        episode.startDate <= reportDay &&
        episode.active !== true &&
        identity &&
        previousCensusEgresoIdentity(row.run, episode.patientName, reportDay) === identity
    );
    if (matches.length !== 1) {
      // A bulk row may omit the final surname. With an explicit OWN RUN, complete name tokens
      // can only remove an unrelated future discovery. They never authorize reconstruction,
      // a maternal association, or an admission/discharge correction.
      const tokens = (name: string) =>
        name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Za-z0-9]+/g, ' ')
          .trim()
          .toUpperCase()
          .split(/\s+/);
      const name = tokens(row.patientName);
      const prefixMatches = index.episodes.filter(episode => {
        const full = tokens(episode.patientName ?? '');
        return (
          /^\d+$/.test(episode.encId) &&
          episode.identifierType === 2 &&
          episode.endDate === reportDay &&
          episode.active !== true &&
          validDay(episode.startDate) &&
          episode.startDate <= reportDay &&
          name.length >= 3 &&
          full.length === name.length + 1 &&
          name.every((token, i) => token === full[i])
        );
      });
      return matches.length === 0 &&
        prefixMatches.length === 1 &&
        prefixMatches[0].startDate > cutoff.slice(0, 10) &&
        !isClinicalCrib
        ? null
        : row;
    }
    const episode = matches[0];
    // Date-only metadata cannot exclude an admission during the following madrugada.
    if (episode.startDate > cutoff.slice(0, 10)) return null;
    // A historical RN in a physical crib still needs its independently verified maternal link.
    if (isClinicalCrib) return row;
    try {
      const results = await dependencies.lookupEgresos([
        { run: row.run, encounterId: episode.encId },
      ]);
      const exact = results.find(
        result =>
          normalizeRut(result.run) === normalizeRut(row.run) && result.encounterId === episode.encId
      );
      if (!exact?.egreso || exact.error || exact.egreso.hasAdministrativeDischarge === false)
        return row;
      const metadataId = String(exact.egreso.id ?? exact.egreso.encounterId ?? episode.encId);
      if (metadataId !== episode.encId) return row;
      const report = await dependencies.fetchStatisticalDischarge(episode.encId);
      if (!report.base64 || report.error) return row;
      const evidence = parseStatisticalDischargeEvidence(
        await dependencies.extractText(decodePdfBase64(report.base64))
      );
      if (
        !evidence ||
        evidence.run !== normalizeRut(row.run) ||
        evidence.admissionAt.slice(0, 10) !== episode.startDate ||
        evidence.dischargeAt.slice(0, 10) !== episode.endDate ||
        evidence.dischargeAt < evidence.admissionAt
      )
        return row;
      if (evidence.admissionAt > cutoff) return null;
      const day = evidence.dischargeAt.slice(0, 10);
      const time = evidence.dischargeAt.slice(11, 16);
      return {
        ...row,
        encounterId: episode.encId,
        exactEpisodeVerification: 'verified',
        admissionDay: evidence.admissionAt.slice(0, 10),
        admissionTime: evidence.admissionAt.slice(11, 16),
        correctedDay: resolveClinicalDayForDateTime(day, time),
        correctedTime: time,
        ...(evidence.isDead === undefined
          ? {}
          : {
              dischargeStatus: evidence.isDead ? ('Fallecido' as const) : ('Vivo' as const),
            }),
      };
    } catch {
      return row;
    }
  };
  const results = new Array<EgresoReportRow | null>(rows.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        results[index] = await recover(rows[index]);
      }
    })
  );
  return results.filter((row): row is EgresoReportRow => row !== null);
};
