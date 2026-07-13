/**
 * Enriches a `CensusImportDiff` with the bulk "Alta Administrativa" egreso report (Fase C).
 *
 * Two pure effects:
 *   1. For every HHR discharge whose RUN appears in the report, set the confirmed destination
 *      (alta / traslado / cma, plus Fallecido) from the report and mark it `rayen-discharge` —
 *      this upgrades inferred `missing-in-rayen` discharges AND refines the destination that
 *      reconcile / Fase B could only guess.
 *   2. Collect the report egresos whose RUN is UNKNOWN to HHR (not in the current census nor the
 *      snapshot) into `reportEgresos` — the "never synced" patients, surfaced for review.
 */

import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import { mapDestinoDeAlta } from '../mapping/mapDestinoDeAlta';
import { toTitleCaseName } from '../mapping/rayenToPatientData';
import { resolveReportBedId } from '../mapping/resolveReportBed';
import { continentalReportToRapaNui } from '../mapping/reportEgresoDateTime';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/** Island (Rapa Nui) egreso day + time from the report's continental stamp; empty fields if unparseable. */
const correctedStamp = (fechaEgreso: string): { correctedDay?: string; correctedTime?: string } => {
  const stamp = continentalReportToRapaNui(fechaEgreso);
  return { correctedDay: stamp?.iso, correctedTime: stamp?.hhmm };
};

/**
 * Every RUN HHR already knows for the day: occupied beds, patients already discharged/moved out
 * in HHR, and everyone in the Rayen snapshot. A report egreso whose RUN is absent from this set
 * is one HHR never synced.
 */
export const collectKnownRuns = (
  record: DailyRecord,
  snapshot: RayenCensusSnapshot
): Set<string> => {
  const runs = new Set<string>();
  const add = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) runs.add(run);
  };
  for (const patient of Object.values(record.beds)) add(patient?.rut);
  for (const record_ of [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ]) {
    add(record_.rut);
  }
  for (const encounter of snapshot.encounters) add(encounter.run);
  return runs;
};

export const applyEgresoReport = (
  diff: CensusImportDiff,
  reportRows: EgresoReportRow[],
  knownRuns: Set<string>
): CensusImportDiff => {
  if (reportRows.length === 0) return diff;

  const byRun = new Map<string, EgresoReportRow>();
  for (const row of reportRows) {
    const run = normalizeRut(row.run);
    if (run) byRun.set(run, row);
  }

  // 1. Confirm + enrich the destination of the HHR discharges the report knows about.
  const discharges = diff.discharges.map(discharge => {
    const row = byRun.get(normalizeRut(discharge.rut));
    if (!row) return discharge;
    const mapped = mapDestinoDeAlta(row.destino, row.motivo);
    return {
      ...discharge,
      kind: mapped.kind,
      status: mapped.status,
      reason: 'rayen-discharge' as const,
      ...correctedStamp(row.fechaEgreso),
    };
  });

  // 2. Report egresos HHR never synced (unknown RUN) → surfaced for review.
  const reportEgresos: ReportEgreso[] = reportRows
    .filter(row => {
      const run = normalizeRut(row.run);
      return run.length > 0 && !knownRuns.has(run);
    })
    .map(row => {
      const mapped = mapDestinoDeAlta(row.destino, row.motivo);
      return {
        run: row.run,
        // Report names come UPPERCASE ("LORENA LOPEZ ALVARADO") → normalize like admissions.
        patientName: toTitleCaseName(row.patientName.replace(/\s+/g, ' ')),
        // "Neo2" → HHR bed id "NEO2", so the logged discharge resolves its bed name + type.
        bedLabel: resolveReportBedId(row.bedLabel),
        destino: row.destino,
        fechaEgreso: row.fechaEgreso,
        kind: mapped.kind,
        status: mapped.status,
        edad: row.edad,
        servicio: row.servicio,
        diagnostico: row.diagnostico,
        ...correctedStamp(row.fechaEgreso),
      };
    });

  return { ...diff, discharges, reportEgresos };
};
