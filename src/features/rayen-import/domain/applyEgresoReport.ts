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
import { confirmHospitalDischarge } from './dischargeVerification';
import {
  correctedStamp,
  hasRecordedMovement,
  occupiedBedsByRun,
  occupiedClinicalCribsByRun,
  reportEgresoFromRow,
  reportPredatesAdmission,
  resolveReportDischarge,
  toIsoDay,
} from './egresoReportPolicy';
import { mergeSyncablePatient } from './patientSyncPolicy';
import { normalizeRut } from '@/utils/rutUtils';

export { collectRecordedMovementRuns } from './egresoReportPolicy';

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
  const occupiedCribs = occupiedClinicalCribsByRun(record);
  const byRun = new Map<string, EgresoReportRow>();
  let diffWithReportConflicts = checkedDiff;
  for (const row of reportRows) {
    const run = normalizeRut(row.run);
    if (!run) continue;
    const normalized = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
    const stamp = normalized.correctedDay && normalized.correctedTime
      ? { iso: normalized.correctedDay, hhmm: normalized.correctedTime }
      : null;
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
    const currentCrib = occupiedCribs.get(run);
    const admissionEvidence = current ?? currentCrib?.patient;
    if (admissionEvidence && reportPredatesAdmission(stamp, admissionEvidence)) {
      diffWithReportConflicts = appendReportConflict(diffWithReportConflicts, {
        bedId: current?.bedId ?? currentCrib?.parentBedId ?? null,
        rut: row.run,
        patientName: current?.patientName ?? currentCrib?.patient.patientName,
        reason: `El egreso informado para ${current?.patientName ?? currentCrib?.patient.patientName ?? row.patientName} es anterior a su ingreso activo; no se desocupó la cama.`,
      });
      continue;
    }
    // Report ordering is not a domain guarantee. Keep the latest eligible statistical event for
    // a RUN so repeated rows cannot make reconciliation depend on workbook row order.
    const previous = byRun.get(run);
    const previousNormalized = previous && correctedStamp(
      previous.fechaEgreso,
      previous.correctedDay,
      previous.correctedTime
    );
    const previousStamp = previousNormalized?.correctedDay && previousNormalized.correctedTime
      ? { iso: previousNormalized.correctedDay, hhmm: previousNormalized.correctedTime }
      : null;
    if (
      !previousStamp ||
      `${stamp.iso}T${stamp.hhmm}` > `${previousStamp.iso}T${previousStamp.hhmm}`
    ) {
      byRun.set(run, row);
    }
  }
  if (byRun.size === 0) return diffWithReportConflicts;

  const confirmedRuns = new Set(byRun.keys());
  type PromotionCandidate = {
    principalRut?: string;
    patient: NonNullable<DailyRecord['beds'][string]>;
    source?: CensusImportDiff['admissions'][number]['source'];
  };
  const activeCribsByParent = new Map<string, PromotionCandidate>();
  for (const crib of checkedDiff.activeClinicalCribs ?? []) {
    activeCribsByParent.set(crib.parentBedId, crib);
  }
  for (const crib of occupiedCribs.values()) {
    const parentRun = normalizeRut(crib.parent?.rut);
    const parentMove = checkedDiff.moves.find(
      entry => entry.fromBedId === crib.parentBedId && normalizeRut(entry.rut) === parentRun
    );
    const effectiveParentBedId = parentMove?.toBedId ?? crib.parentBedId;
    if (!activeCribsByParent.has(effectiveParentBedId)) {
      activeCribsByParent.set(effectiveParentBedId, {
        principalRut: crib.parent.rut,
        patient: crib.patient,
      });
    }
  }
  const principalBedByRun = new Map<string, string>();
  for (const [run, current] of occupied) principalBedByRun.set(run, current.bedId);
  for (const admission of checkedDiff.admissions) {
    principalBedByRun.set(normalizeRut(admission.patient.rut), admission.bedId);
  }
  for (const move of checkedDiff.moves) {
    principalBedByRun.set(normalizeRut(move.rut), move.toBedId);
  }
  const promotedCribs = new Map<string, PromotionCandidate>();
  for (const [run] of byRun) {
    const parentBedId = principalBedByRun.get(run);
    if (!parentBedId) continue;
    const crib = activeCribsByParent.get(parentBedId);
    const hasDifferentIncomingPrincipal =
      checkedDiff.admissions.some(
        entry => entry.bedId === parentBedId && normalizeRut(entry.patient.rut) !== run
      ) ||
      checkedDiff.moves.some(
        entry => entry.toBedId === parentBedId && normalizeRut(entry.rut) !== run
      );
    if (
      crib &&
      normalizeRut(crib.principalRut) === run &&
      !hasDifferentIncomingPrincipal &&
      !confirmedRuns.has(normalizeRut(crib.patient.rut))
    ) {
      promotedCribs.set(parentBedId, crib);
    }
  }
  const promotedCribRuns = new Set(
    [...promotedCribs.values()].map(crib => normalizeRut(crib.patient.rut))
  );
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
  const unchangedCribRuns = new Set(
    (checkedDiff.activeClinicalCribs ?? [])
      .map(crib => normalizeRut(crib.patient.rut))
      .filter(run => occupiedCribs.has(run) && !plannedRuns.has(run))
  );

  // Remove provisional Ficha-derived operations for administratively discharged RUNs.
  const admissions = checkedDiff.admissions
    .filter(entry => !confirmedRuns.has(normalizeRut(entry.patient.rut)))
    .map(entry => {
      const cribRun = normalizeRut(entry.patient.clinicalCrib?.rut);
      if (!cribRun || !confirmedRuns.has(cribRun)) return entry;
      return {
        ...entry,
        patient: { ...entry.patient, clinicalCrib: undefined },
      };
    });
  for (const [bedId, crib] of promotedCribs) {
    const currentCrib = occupiedCribs.get(normalizeRut(crib.patient.rut))?.patient;
    const promotedPatient = currentCrib
      ? mergeSyncablePatient(currentCrib, crib.patient)
      : crib.patient;
    admissions.push({
      bedId,
      patient: {
        ...promotedPatient,
        bedId,
        bedMode: 'Cuna',
        hasCompanionCrib: false,
        clinicalCrib: undefined,
        clinicalEpisodeId: crib.patient.clinicalEpisodeId || promotedPatient.clinicalEpisodeId,
      },
      isCma: false,
      source: crib.source,
    });
  }
  const updates = checkedDiff.updates.filter(entry => {
    const run = normalizeRut(entry.rut);
    if (confirmedRuns.has(run)) return false;
    return !(
      promotedCribs.has(entry.bedId) &&
      promotedCribRuns.has(run) &&
      entry.changes.some(change => change.field === 'clinicalCrib')
    );
  });
  const moves = checkedDiff.moves.filter(entry => !confirmedRuns.has(normalizeRut(entry.rut)));
  const pendingAdministrativeDischarges = checkedDiff.pendingAdministrativeDischarges.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.rut))
  );
  const conflicts = diffWithReportConflicts.conflicts.filter(entry => {
    const run = normalizeRut(entry.rut);
    if (run && confirmedRuns.has(run)) return false;
    return !(
      entry.bedId !== null &&
      promotedCribs.has(entry.bedId) &&
      promotedCribRuns.has(run) &&
      entry.reason === `La cama principal ${entry.bedId} no fue confirmada en el censo activo de Rayen.`
    );
  });

  const discharges = checkedDiff.discharges.filter(
    entry => !confirmedRuns.has(normalizeRut(entry.rut))
  );
  const reportEgresos: ReportEgreso[] = [];
  let overriddenUnchanged = 0;
  for (const cribRun of unchangedCribRuns) {
    if (confirmedRuns.has(cribRun)) overriddenUnchanged += 1;
  }

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
      const promotedCrib = promotedCribs.get(current.bedId);
      if (promotedCrib && unchangedCribRuns.has(normalizeRut(promotedCrib.patient.rut))) {
        overriddenUnchanged += 1;
      }
      discharges.push({
        bedId: current.bedId,
        rut: row.run,
        patientName: current.patientName,
        kind: mapped.kind,
        status: mapped.status,
        reason: 'administrative-discharge',
        encounterId: row.encounterId ?? current.clinicalEpisodeId,
        verification: confirmHospitalDischarge(pending?.verification),
        ...correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime),
      });
      continue;
    }
    const currentCrib = occupiedCribs.get(run);
    if (currentCrib) {
      const parentRun = normalizeRut(currentCrib.parent.rut);
      if (!confirmedRuns.has(parentRun)) {
        const parentMove = checkedDiff.moves.find(entry => normalizeRut(entry.rut) === parentRun);
        const targetBedId = parentMove?.toBedId ?? currentCrib.parentBedId;
        const source =
          checkedDiff.pendingAdministrativeDischarges.find(
            entry => normalizeRut(entry.rut) === run
          )?.source ??
          checkedDiff.activeClinicalCribs?.find(
            crib => normalizeRut(crib.patient.rut) === run
          )?.source;
        updates.push({
          bedId: targetBedId,
          rut: currentCrib.patient.rut,
          patientName: currentCrib.patient.patientName,
          changes: [{
            field: 'clinicalCrib',
            from: currentCrib.patient,
            to: undefined,
          }],
          patient: { ...currentCrib.parent, bedId: targetBedId },
          source,
        });
      }
      const encounterId = row.encounterId ?? currentCrib.patient.clinicalEpisodeId;
      if (hasRecordedMovement(record, row.run, encounterId)) continue;
      reportEgresos.push(reportEgresoFromRow({ ...row, encounterId }));
      continue;
    }
    if (hasRecordedMovement(record, row.run, row.encounterId)) continue;
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
