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
import { confirmHospitalDischarge } from './dischargeVerification';
import { normalizeRut } from '@/utils/rutUtils';

const markReportChecked = (diff: CensusImportDiff): CensusImportDiff => {
  if (diff.pendingAdministrativeDischarges.length === 0) return diff;
  return {
    ...diff,
    pendingAdministrativeDischarges: diff.pendingAdministrativeDischarges.map(entry => ({
      ...entry,
      verification: { ...entry.verification, hospitalDischarge: 'not-detected' },
    })),
  };
};

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
  return '';
};

interface CmaOriginEvidence {
  admissionDate?: string;
  admissionTime?: string;
  /** Eloísa location stored when the patient occupied the bed. */
  location?: string;
}

const timeFrom = (raw?: string): string | undefined => {
  const match = (raw ?? '').match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const reportPredatesAdmission = (
  stamp: { iso: string; hhmm: string },
  evidence: CmaOriginEvidence
): boolean => {
  const admissionDay = toIsoDay(evidence.admissionDate ?? '');
  if (!admissionDay) return false;
  if (stamp.iso !== admissionDay) return stamp.iso < admissionDay;
  const admissionTime = timeFrom(evidence.admissionTime) ?? timeFrom(evidence.admissionDate);
  return admissionTime ? stamp.hhmm < admissionTime : false;
};

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
  {
    bedId: string;
    patientName: string;
    admissionDate?: string;
    admissionTime?: string;
    location?: string;
  }
> => {
  const byRun = new Map<
    string,
    {
      bedId: string;
      patientName: string;
      admissionDate?: string;
      admissionTime?: string;
      location?: string;
    }
  >();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = normalizeRut(patient.rut);
    if (run) {
      byRun.set(run, {
        bedId,
        patientName: patient.patientName,
        admissionDate: patient.admissionDate,
        admissionTime: patient.admissionTime,
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

const appendReportConflict = (
  diff: CensusImportDiff,
  conflict: CensusImportDiff['conflicts'][number]
): CensusImportDiff => {
  const conflicts = [...diff.conflicts, conflict];
  return {
    ...diff,
    conflicts,
    summary: { ...diff.summary, conflicts: conflicts.length },
  };
};

/** Keeps a failed authority lookup visible and prevents the automatic path from applying the diff. */
export const markEgresoReportUnavailable = (diff: CensusImportDiff): CensusImportDiff =>
  appendReportConflict(diff, {
    bedId: null,
    reason:
      'No se pudo consultar el informe de altas administrativas de Gestión de Camas; los egresos no están verificados.',
  });

export const applyEgresoReport = (
  diff: CensusImportDiff,
  reportRows: EgresoReportRow[],
  record: DailyRecord
): CensusImportDiff => {
  const checkedDiff = markReportChecked(diff);
  if (reportRows.length === 0) return checkedDiff;

  const recordDay = toIsoDay(record.date);
  const occupied = occupiedBedsByRun(record);
  const byRun = new Map<string, EgresoReportRow>();
  let diffWithReportConflicts = checkedDiff;
  for (const row of reportRows) {
    const run = normalizeRut(row.run);
    if (!run) continue;
    const stamp = parseStatisticalEgresoStamp(row.fechaEgreso);
    if (!stamp) {
      diffWithReportConflicts = appendReportConflict(diffWithReportConflicts, {
        bedId: null,
        rut: row.run,
        reason: `El informe de Gestión de Camas contiene una fecha/hora de egreso inválida para el RUN ${row.run}; no se aplicó.`,
      });
      continue;
    }
    // The query intentionally reaches D+1 to compensate Rayen's date offset. A genuine
    // next-island-day discharge must never be pulled backwards into the current census.
    if (!recordDay || stamp.iso > recordDay) continue;
    const current = occupied.get(run);
    if (current && reportPredatesAdmission(stamp, current)) {
      diffWithReportConflicts = appendReportConflict(diffWithReportConflicts, {
        bedId: current.bedId,
        rut: row.run,
        patientName: current.patientName,
        reason: `El egreso informado para ${current.patientName} es anterior a su ingreso activo; no se desocupó la cama.`,
      });
      continue;
    }
    // Report ordering is not a domain guarantee. Keep the latest eligible statistical event for
    // a RUN so repeated rows cannot make reconciliation depend on workbook row order.
    const previous = byRun.get(run);
    const previousStamp = previous && parseStatisticalEgresoStamp(previous.fechaEgreso);
    if (
      !previousStamp ||
      `${stamp.iso}T${stamp.hhmm}` > `${previousStamp.iso}T${previousStamp.hhmm}`
    ) {
      byRun.set(run, row);
    }
  }
  if (byRun.size === 0) return diffWithReportConflicts;

  const confirmedRuns = new Set(byRun.keys());
  const recordedRuns = collectRecordedMovementRuns(record);
  const plannedRuns = new Set<string>();
  const addPlannedRun = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) plannedRuns.add(run);
  };
  checkedDiff.admissions.forEach(entry => addPlannedRun(entry.patient.rut));
  checkedDiff.updates.forEach(entry => addPlannedRun(entry.rut));
  checkedDiff.moves.forEach(entry => addPlannedRun(entry.rut));
  checkedDiff.pendingAdministrativeDischarges.forEach(entry => addPlannedRun(entry.rut));
  checkedDiff.conflicts.forEach(entry => addPlannedRun(entry.rut));

  // Remove provisional Ficha-derived operations for administratively discharged RUNs.
  const admissions = checkedDiff.admissions.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.patient.rut))
  );
  const updates = checkedDiff.updates.filter(entry => !confirmedRuns.has(normalizeRut(entry.rut)));
  const moves = checkedDiff.moves.filter(entry => !confirmedRuns.has(normalizeRut(entry.rut)));
  const pendingAdministrativeDischarges = checkedDiff.pendingAdministrativeDischarges.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.rut))
  );
  const conflicts = diffWithReportConflicts.conflicts.filter(
    entry => !entry.rut || !confirmedRuns.has(normalizeRut(entry.rut))
  );

  const discharges = checkedDiff.discharges.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.rut))
  );
  const reportEgresos: ReportEgreso[] = [];
  let overriddenUnchanged = 0;

  for (const [run, row] of byRun) {
    const current = occupied.get(run);
    const mapped = resolveReportDischarge(row, current);
    if (current) {
      const pending = checkedDiff.pendingAdministrativeDischarges.find(
        entry => normalizeRut(entry.rut) === run
      );
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
        encounterId: row.encounterId,
        verification: confirmHospitalDischarge(pending?.verification),
        ...correctedStamp(row.fechaEgreso),
      });
      continue;
    }
    if (recordedRuns.has(run)) continue;
    reportEgresos.push(reportEgresoFromRow(row));
  }

  return {
    ...checkedDiff,
    admissions,
    updates,
    moves,
    discharges,
    pendingAdministrativeDischarges,
    conflicts,
    reportEgresos,
    unchangedCount: Math.max(0, checkedDiff.unchangedCount - overriddenUnchanged),
    summary: {
      ...checkedDiff.summary,
      admissions: admissions.length,
      updates: updates.length,
      moves: moves.length,
      discharges: discharges.length,
      pendingAdministrativeDischarges: pendingAdministrativeDischarges.length,
      conflicts: conflicts.length,
      unchanged: Math.max(0, checkedDiff.summary.unchanged - overriddenUnchanged),
    },
  };
};
