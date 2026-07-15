/**
 * Enriches a `CensusImportDiff` with the bulk "Alta Administrativa" egreso report (Fase C).
 *
 * The Gestión de Camas report is the ONLY authority for statistical discharge movements.
 * Clinical closure flags and absence from Ficha Médico remain informative pending signals.
 *
 * Pure effects:
 *   1. A report row matching an occupied HHR bed creates the definitive alta / traslado / CMA.
 *   2. The report overrides provisional Ficha plans (admission/update/move/pending) for that RUN.
 *   3. A report row not already represented in HHR becomes a review-gated `reportEgreso`.
 */

import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import { mapDestinoDeAlta } from '../mapping/mapDestinoDeAlta';
import { toTitleCaseName } from '../mapping/rayenToPatientData';
import { resolveReportBedId } from '../mapping/resolveReportBed';
import { isCmaBedLabel, isCmaLocation } from '../mapping/bedMapping';
import { parseStatisticalEgresoStamp } from '../mapping/reportEgresoDateTime';

const normalizeRut = (rut?: string): string => (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/** Official Rapa Nui egreso day + time as printed by Gestión de Camas. */
const correctedStamp = (fechaEgreso: string): { correctedDay?: string; correctedTime?: string } => {
  const stamp = parseStatisticalEgresoStamp(fechaEgreso);
  return { correctedDay: stamp?.iso, correctedTime: stamp?.hhmm };
};

/** Every RUN already represented by a statistical movement, including tombstones. */
export const collectRecordedMovementRuns = (record: DailyRecord): Set<string> => {
  const runs = new Set<string>();
  const add = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) runs.add(run);
  };
  for (const record_ of [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ]) {
    add(record_.rut);
  }
  return runs;
};

const toIsoDay = (raw: string): string => {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return raw;
};

interface CmaOriginEvidence {
  admissionDate?: string;
  /** Eloísa location stored when the patient occupied the bed. */
  location?: string;
}

const resolveReportDischarge = (row: EgresoReportRow, evidence: CmaOriginEvidence = {}) => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  const dischargeDay = correctedStamp(row.fechaEgreso).correctedDay;
  const hasExactCmaBed = isCmaLocation(evidence.location) || isCmaBedLabel(row.bedLabel);
  const isSameDayCma =
    mapped.kind === 'alta' &&
    mapped.status === 'Vivo' &&
    hasExactCmaBed &&
    Boolean(evidence.admissionDate) &&
    toIsoDay(evidence.admissionDate ?? '') === dischargeDay;

  return isSameDayCma ? { ...mapped, kind: 'cma' as const } : mapped;
};

const occupiedBedsByRun = (
  record: DailyRecord
): Map<
  string,
  { bedId: string; patientName: string; admissionDate?: string; location?: string }
> => {
  const byRun = new Map<
    string,
    { bedId: string; patientName: string; admissionDate?: string; location?: string }
  >();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = normalizeRut(patient.rut);
    if (run) {
      byRun.set(run, {
        bedId,
        patientName: patient.patientName,
        admissionDate: patient.admissionDate,
        location: patient.location,
      });
    }
  }
  return byRun;
};

const reportEgresoFromRow = (row: EgresoReportRow): ReportEgreso => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  return {
    run: row.run,
    patientName: toTitleCaseName(row.patientName.replace(/\s+/g, ' ')),
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
};

export const applyEgresoReport = (
  diff: CensusImportDiff,
  reportRows: EgresoReportRow[],
  record: DailyRecord
): CensusImportDiff => {
  if (reportRows.length === 0) return diff;

  const recordDay = toIsoDay(record.date);
  const byRun = new Map<string, EgresoReportRow>();
  for (const row of reportRows) {
    const run = normalizeRut(row.run);
    const rowDay = correctedStamp(row.fechaEgreso).correctedDay;
    // The query intentionally reaches D+1 to compensate Rayen's date offset. A genuine
    // next-island-day discharge must never be pulled backwards into the current census.
    if (run && (!rowDay || rowDay <= recordDay)) byRun.set(run, row);
  }
  if (byRun.size === 0) return diff;

  const confirmedRuns = new Set(byRun.keys());
  const recordedRuns = collectRecordedMovementRuns(record);
  const occupied = occupiedBedsByRun(record);
  const plannedRuns = new Set<string>();
  const addPlannedRun = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) plannedRuns.add(run);
  };
  diff.admissions.forEach(entry => addPlannedRun(entry.patient.rut));
  diff.updates.forEach(entry => addPlannedRun(entry.rut));
  diff.moves.forEach(entry => addPlannedRun(entry.rut));
  diff.pendingAdministrativeDischarges.forEach(entry => addPlannedRun(entry.rut));
  diff.conflicts.forEach(entry => addPlannedRun(entry.rut));

  // Remove provisional Ficha-derived operations for administratively discharged RUNs.
  const admissions = diff.admissions.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.patient.rut))
  );
  const updates = diff.updates.filter(entry => !confirmedRuns.has(normalizeRut(entry.rut)));
  const moves = diff.moves.filter(entry => !confirmedRuns.has(normalizeRut(entry.rut)));
  const pendingAdministrativeDischarges = diff.pendingAdministrativeDischarges.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.rut))
  );
  const conflicts = diff.conflicts.filter(
    entry => !entry.rut || !confirmedRuns.has(normalizeRut(entry.rut))
  );

  const discharges = diff.discharges.filter(entry => !confirmedRuns.has(normalizeRut(entry.rut)));
  const reportEgresos: ReportEgreso[] = [];
  let overriddenUnchanged = 0;

  for (const [run, row] of byRun) {
    const current = occupied.get(run);
    const mapped = resolveReportDischarge(row, current);
    if (current) {
      // An active, unchanged Ficha encounter has no explicit diff entry. Once Gestión de Camas
      // confirms its departure it must stop contributing to the "sin cambios" aggregate.
      if (!plannedRuns.has(run)) overriddenUnchanged += 1;
      discharges.push({
        bedId: current.bedId,
        rut: row.run,
        patientName: current.patientName,
        kind: mapped.kind,
        status: mapped.status,
        reason: 'administrative-discharge',
        ...correctedStamp(row.fechaEgreso),
      });
      continue;
    }
    if (recordedRuns.has(run)) continue;
    reportEgresos.push(reportEgresoFromRow(row));
  }

  return {
    ...diff,
    admissions,
    updates,
    moves,
    discharges,
    pendingAdministrativeDischarges,
    conflicts,
    reportEgresos,
    unchangedCount: Math.max(0, diff.unchangedCount - overriddenUnchanged),
    summary: {
      ...diff.summary,
      admissions: admissions.length,
      updates: updates.length,
      moves: moves.length,
      discharges: discharges.length,
      pendingAdministrativeDischarges: pendingAdministrativeDischarges.length,
      conflicts: conflicts.length,
      unchanged: Math.max(0, diff.summary.unchanged - overriddenUnchanged),
    },
  };
};
