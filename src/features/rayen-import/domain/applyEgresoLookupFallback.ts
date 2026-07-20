import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { EgresoLookupResult, EgresoRecord } from '../contracts/egresoLookup';
import { applyEgresoReport } from './applyEgresoReport';
import { confirmHospitalDischarge } from './dischargeVerification';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const lookupStamp = (egreso: EgresoRecord): string => {
  const raw = String(egreso.dateDischarge || egreso.endPeriod || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})/);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]} ${iso[4]}:${iso[5]}` : raw;
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
    const pending = diff.pendingAdministrativeDischarges.find(
      entry => normalizeRut(entry.rut) === normalizeRut(result.run)
    );
    if (
      !pending?.encounterId ||
      result.encounterId !== pending.encounterId ||
      !result.egreso ||
      !hasConfirmedAdministrativeDischarge(result.egreso)
    ) {
      continue;
    }
    eligible.set(normalizeRut(result.run), { result, pending });
  }
  return eligible;
};

const reportRowFromLookup = ({ result, pending }: EligibleLookup): EgresoReportRow => {
  const egreso = result.egreso as EgresoRecord;
  return {
    run: result.run,
    patientName: pending.patientName,
    bedLabel: pending.bedId,
    servicio: '',
    edad: '',
    destino: lookupDestination(egreso),
    motivo: String(egreso.dischargeReasonName || ''),
    fechaEgreso: lookupStamp(egreso),
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

  const enriched = applyEgresoReport(diff, [...eligible.values()].map(reportRowFromLookup), record);
  return {
    ...enriched,
    discharges: enriched.discharges.map(discharge => {
      const match = eligible.get(normalizeRut(discharge.rut));
      return match
        ? {
            ...discharge,
            verification: confirmHospitalDischarge(match.pending.verification, match.result.egreso),
          }
        : discharge;
    }),
  };
};
