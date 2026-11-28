import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import type { EgresoLookupResult, EgresoRecord } from '../contracts/egresoLookup';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';
import type { CorrectedEgresoFields } from '../mapping/reportEgresoDateTime';
import { correctedEgresoFields } from '../mapping/reportEgresoDateTime';
import { applyEgresoReport } from './applyEgresoReport';
import { confirmHospitalDischarge } from './dischargeVerification';
import {
  hasNonRutLetter,
  isSameForeignDocument,
  normalizeForeignDocument,
  normalizeRut,
} from '@/utils/rutUtils';

const lookupKey = (rut: string | undefined, encounterId: string | undefined): string =>
  `${hasNonRutLetter(rut ?? '') ? normalizeForeignDocument(rut) : normalizeRut(rut)}::${String(encounterId || '').trim()}`;

const matchesPendingLookup = (
  pending: Pick<PendingDischarge, 'rut' | 'encounterId'>,
  result: Pick<EgresoLookupResult, 'run' | 'encounterId'>
): boolean => {
  const expectedEpisode = String(pending.encounterId || '').trim();
  const returnedEpisode = String(result.encounterId || '').trim();
  if (!expectedEpisode || expectedEpisode !== returnedEpisode) return false;
  if (isSameForeignDocument(pending.rut, result.run)) return true;
  return (
    !hasNonRutLetter(result.run ?? '') &&
    Boolean(normalizeRut(pending.rut)) &&
    normalizeRut(pending.rut) === normalizeRut(result.run)
  );
};

const reportEgresoKey = (egreso: ReportEgreso): string =>
  egreso.encounterId?.trim() ||
  [
    hasNonRutLetter(egreso.run) ? normalizeForeignDocument(egreso.run) : normalizeRut(egreso.run),
    egreso.patientName.trim().toLocaleUpperCase(),
    egreso.correctedDay ?? '',
    egreso.correctedTime ?? '',
    egreso.fromClinicalCrib ? 'crib' : 'principal',
  ].join('|');

const mergeReportEgresos = (
  previous: readonly ReportEgreso[],
  next: readonly ReportEgreso[]
): ReportEgreso[] => {
  const merged = new Map<string, ReportEgreso>();
  for (const egreso of [...previous, ...next]) merged.set(reportEgresoKey(egreso), egreso);
  return [...merged.values()];
};

const lookupStamp = (egreso: EgresoRecord): { fechaEgreso: string } & CorrectedEgresoFields => {
  const raw = String(egreso.dateDischarge || egreso.endPeriod || '').trim();
  const local = /[T\s]\d{1,2}:\d{2}/.test(raw) ? encounterWallClockInRapaNui(raw) : null;
  if (!local) return { fechaEgreso: raw };
  // An individual API clock is not a mainland bulk-report cell. Preserve its raw evidence.
  return { fechaEgreso: raw, ...correctedEgresoFields(local.slice(0, 10), local.slice(11, 16)) };
};

const lookupDestination = (egreso: EgresoRecord): string =>
  ([
    egreso.dischargeDestination,
    egreso.dischargeDestinationName,
    egreso.destinationSystemName,
    egreso.dischargeTypeName,
    egreso.bedDestination,
    egreso.destinationBed,
  ].find(value => typeof value === 'string' && value.trim()) as string | undefined) ?? '';

const hasConfirmedAdministrativeDischarge = (egreso: EgresoRecord): boolean => {
  if (typeof egreso.hasAdministrativeDischarge === 'boolean') {
    return egreso.hasAdministrativeDischarge;
  }
  return Boolean(String(egreso.dateDischarge || egreso.endPeriod || '').trim());
};

type PendingDischarge = CensusImportDiff['pendingAdministrativeDischarges'][number];
type EligibleLookup = { result: EgresoLookupResult; pending: PendingDischarge };

const eligibleLookups = (
  diff: CensusImportDiff,
  lookupResults: EgresoLookupResult[]
): Map<string, EligibleLookup> => {
  const eligible = new Map<string, EligibleLookup>();
  for (const result of lookupResults) {
    const pending = diff.pendingAdministrativeDischarges.find(entry =>
      matchesPendingLookup(entry, result)
    );
    if (
      !pending?.encounterId ||
      !result.egreso ||
      !hasConfirmedAdministrativeDischarge(result.egreso)
    ) {
      continue;
    }
    eligible.set(lookupKey(pending.rut, pending.encounterId), { result, pending });
  }
  return eligible;
};

export const reportRowFromLookup = (
  result: EgresoLookupResult,
  pending: Pick<PendingDischarge, 'patientName' | 'bedId'>
): EgresoReportRow => {
  const egreso = result.egreso as EgresoRecord;
  const stamp = lookupStamp(egreso);
  return {
    run: result.run,
    encounterId: result.encounterId,
    patientName: pending.patientName,
    bedLabel: pending.bedId,
    servicio: '',
    edad: '',
    destino: lookupDestination(egreso),
    motivo: String(egreso.dischargeReasonName || ''),
    ...stamp,
    ...(typeof egreso.isDead === 'boolean'
      ? { dischargeStatus: egreso.isDead ? ('Fallecido' as const) : ('Vivo' as const) }
      : {}),
  };
};

/**
 * Complements the bulk report with an exact per-episode Gestión de Camas lookup.
 * A result for another hospitalization of the same RUN is deliberately ignored.
 */
export const applyEgresoLookupFallback = (
  diff: CensusImportDiff,
  lookupResults: EgresoLookupResult[],
  record: DailyRecord
): CensusImportDiff => {
  const eligible = eligibleLookups(diff, lookupResults);
  if (eligible.size === 0) return diff;

  const enriched = applyEgresoReport(
    diff,
    [...eligible.values()].map(({ result, pending }) => reportRowFromLookup(result, pending)),
    record
  );
  return {
    ...enriched,
    reportEgresos: mergeReportEgresos(diff.reportEgresos ?? [], enriched.reportEgresos ?? []),
    discharges: enriched.discharges.map(discharge => {
      const match = eligible.get(lookupKey(discharge.rut, discharge.encounterId));
      return match
        ? {
            ...discharge,
            verification: confirmHospitalDischarge(match.pending.verification, match.result.egreso),
          }
        : discharge;
    }),
  };
};
