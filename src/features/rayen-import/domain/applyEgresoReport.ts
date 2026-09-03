import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import { confirmHospitalDischarge } from './dischargeVerification';
import {
  correctedStamp,
  createReportEpisodeMatcher,
  clinicalCribConflictBeds,
  findPlannedBedByEpisode,
  findOccupiedBed,
  findOccupiedClinicalCrib,
  hasRecordedMovement,
  hasPlannedPatientIdentity,
  indexPrincipalBeds,
  occupiedBedsByRun,
  occupiedClinicalCribsByRun,
  reportEgresoFromRow,
  resolveActiveEpisode,
  resolveReportDischarge,
  selectReportRowsByEpisode,
  unchangedClinicalCribEpisodes,
} from './egresoReportPolicy';
import { mergeSyncablePatient } from './patientSyncPolicy';
import { resolveReleasedBedPlacements } from './resolveReleasedBedPlacements';
import { markReportChecked } from './egresoReportConflicts';
import { normalizeRut } from '@/utils/rutUtils';
import { selectEligibleEgresoRows, type PromotionCandidate } from './egresoReportEligibility';
import { dropRedundantUnverifiedReportConflicts } from './redundantReportRowConflicts';
import { buildClinicalCribPromotionCandidates } from './associatedClinicalCribDischarge';
import { finalizeDischargePlan, resolveReportedOccupant } from './dischargePlanInvariants';
import { isPavilionRecoveryLocation } from './pavilionRecoverySyncPolicy';
export { collectRecordedMovementRuns } from './egresoReportPolicy';
export { markEgresoReportUnavailable } from './egresoReportConflicts';
export const applyEgresoReport = (
  diff: CensusImportDiff,
  reportRows: EgresoReportRow[],
  record: DailyRecord
): CensusImportDiff => {
  const checkedDiff = markReportChecked(diff);
  const eligibleLocationRows = reportRows.filter(row => !isPavilionRecoveryLocation(row.bedLabel));
  if (eligibleLocationRows.length === 0) return checkedDiff;
  const occupied = occupiedBedsByRun(record);
  const occupiedCribs = occupiedClinicalCribsByRun(record);
  const { diff: diffWithReportConflicts, rows: eligibleRows } = selectEligibleEgresoRows(
    checkedDiff,
    eligibleLocationRows,
    record
  );
  const { primaryByRun: byRun, supplemental } = selectReportRowsByEpisode(eligibleRows, key =>
    key.startsWith('episode:')
      ? key.slice(8)
      : resolveActiveEpisode(
          checkedDiff,
          key,
          findOccupiedBed(occupied, key)?.clinicalEpisodeId ??
            findOccupiedClinicalCrib(occupiedCribs, key)?.patient.clinicalEpisodeId
        )
  );
  if (byRun.size === 0) return diffWithReportConflicts;
  const reportConfirmsEpisode = createReportEpisodeMatcher(byRun);
  const activeCribsByParent = buildClinicalCribPromotionCandidates(checkedDiff, occupiedCribs);
  const principalBedByRun = indexPrincipalBeds(checkedDiff, occupied);
  const conflictedCribParents = clinicalCribConflictBeds(checkedDiff);
  const promotedCribs = new Map<string, PromotionCandidate>();
  for (const [, reportRow] of byRun) {
    const run = normalizeRut(reportRow.run);
    const reportedEpisode = String(reportRow.encounterId ?? '').trim();
    const exactPrincipal = findOccupiedBed(occupied, reportRow.run, reportRow.encounterId);
    const exactPlannedBed = findPlannedBedByEpisode(checkedDiff, reportedEpisode);
    const parentBedId = exactPlannedBed ?? exactPrincipal?.bedId ?? principalBedByRun.get(run);
    if (!parentBedId) continue;
    const crib = activeCribsByParent.get(parentBedId);
    const hasDifferentIncomingPrincipal =
      checkedDiff.admissions.some(
        entry =>
          entry.bedId === parentBedId &&
          entry.source?.encounterId !== reportedEpisode &&
          normalizeRut(entry.patient.rut) !== run
      ) ||
      checkedDiff.moves.some(
        entry =>
          entry.toBedId === parentBedId &&
          entry.source.encounterId !== reportedEpisode &&
          normalizeRut(entry.rut) !== run
      ) ||
      checkedDiff.conflicts.some(
        entry =>
          entry.scope !== 'clinical-crib' &&
          entry.bedId === parentBedId &&
          entry.source?.encounterId !== reportedEpisode &&
          Boolean(normalizeRut(entry.source?.run ?? entry.rut))
      );
    if (
      crib &&
      (exactPrincipal?.clinicalEpisodeId === reportedEpisode ||
        exactPlannedBed === parentBedId ||
        (run ? normalizeRut(crib.principalRut) === run : exactPrincipal?.bedId === parentBedId)) &&
      !conflictedCribParents.has(parentBedId) &&
      !hasDifferentIncomingPrincipal &&
      reportConfirmsEpisode(
        run,
        resolveActiveEpisode(checkedDiff, run, exactPrincipal?.clinicalEpisodeId),
        true
      ) &&
      !reportConfirmsEpisode(
        crib.patient.rut,
        crib.source?.encounterId ?? crib.patient.clinicalEpisodeId
      )
    ) {
      promotedCribs.set(parentBedId, crib);
    }
  }
  const promotedCribRuns = new Set(
    [...promotedCribs.values()].map(crib => normalizeRut(crib.patient.rut))
  );
  const unchangedCribEpisodes = unchangedClinicalCribEpisodes(checkedDiff, occupiedCribs);
  const admissions = checkedDiff.admissions
    .filter(
      entry =>
        !reportConfirmsEpisode(
          entry.patient.rut,
          entry.source?.encounterId ?? entry.patient.clinicalEpisodeId
        )
    )
    .map(entry => {
      const cribRun = normalizeRut(entry.patient.clinicalCrib?.rut);
      if (!reportConfirmsEpisode(cribRun, entry.patient.clinicalCrib?.clinicalEpisodeId))
        return entry;
      return {
        ...entry,
        patient: { ...entry.patient, clinicalCrib: undefined },
      };
    });
  for (const [bedId, crib] of promotedCribs) {
    const currentCrib = findOccupiedClinicalCrib(
      occupiedCribs,
      crib.patient.rut,
      crib.source?.encounterId,
      bedId
    )?.patient;
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
  const updates = checkedDiff.updates.flatMap(entry => {
    const run = normalizeRut(entry.rut);
    if (reportConfirmsEpisode(run, entry.source?.encounterId)) {
      const changes = entry.changes.filter(change => change.field !== 'clinicalCrib');
      return changes.length ? [{ ...entry, changes }] : [];
    }
    const removesPromotedCrib =
      promotedCribs.has(entry.bedId) &&
      promotedCribRuns.has(run) &&
      entry.changes.some(change => change.field === 'clinicalCrib');
    return removesPromotedCrib ? [] : [entry];
  });
  // A confirmed egreso supersedes its provisional move so apply order cannot relocate it.
  const moves = checkedDiff.moves.filter(
    entry => !reportConfirmsEpisode(entry.rut, entry.source.encounterId)
  );
  const pendingAdministrativeDischarges = checkedDiff.pendingAdministrativeDischarges.filter(
    entry => !reportConfirmsEpisode(entry.rut, entry.encounterId ?? entry.source?.encounterId)
  );
  const conflicts = diffWithReportConflicts.conflicts.filter(entry => {
    const run = normalizeRut(entry.rut);
    if (reportConfirmsEpisode(run, entry.source?.encounterId)) {
      const occupant = entry.bedId ? record.beds[entry.bedId] : undefined;
      const conflictedPatient = entry.scope === 'clinical-crib' ? occupant?.clinicalCrib : occupant;
      const identitylessOccupant =
        conflictedPatient?.patientName?.trim() &&
        !normalizeRut(conflictedPatient.rut) &&
        !conflictedPatient.clinicalEpisodeId;
      if (!identitylessOccupant) return false;
    }
    return !(
      entry.bedId !== null &&
      promotedCribs.has(entry.bedId) &&
      promotedCribRuns.has(run) &&
      entry.code === 'unconfirmed-principal-bed'
    );
  });
  const discharges = checkedDiff.discharges.filter(
    entry => !reportConfirmsEpisode(entry.rut, entry.encounterId ?? entry.source?.encounterId)
  );
  const reportEgresos: ReportEgreso[] = [];
  let overriddenUnchanged = 0;
  for (const cribEpisode of unchangedCribEpisodes) {
    const activeCrib = checkedDiff.activeClinicalCribs?.find(
      crib => crib.source.encounterId === cribEpisode
    );
    if (
      reportConfirmsEpisode(
        activeCrib?.patient.rut,
        activeCrib?.source.encounterId ?? activeCrib?.patient.clinicalEpisodeId
      )
    )
      overriddenUnchanged += 1;
  }
  for (const [, row] of byRun) {
    const run = normalizeRut(row.run);
    const current = resolveReportedOccupant(occupied, occupiedCribs, row.run, row.encounterId);
    const mapped = resolveReportDischarge(row, current);
    if (current) {
      const reportedEpisode = String(row.encounterId ?? '').trim();
      const activeEpisode =
        reportedEpisode === current.clinicalEpisodeId
          ? reportedEpisode
          : resolveActiveEpisode(checkedDiff, run, current.clinicalEpisodeId);
      if (reportedEpisode && reportedEpisode !== activeEpisode) {
        if (activeEpisode && !hasRecordedMovement(record, row.run, reportedEpisode)) {
          reportEgresos.push(reportEgresoFromRow(row));
        } else if (!activeEpisode) {
          conflicts.push({
            bedId: current.bedId,
            rut: row.run,
            patientName: current.patientName,
            reason:
              'El egreso identifica un episodio, pero el episodio activo de HHR no se pudo confirmar.',
          });
        }
        continue;
      }
      const pending = checkedDiff.pendingAdministrativeDischarges.find(
        entry => normalizeRut(entry.rut) === run
      );
      // Confirmed departures stop contributing to the unchanged aggregate.
      if (!hasPlannedPatientIdentity(checkedDiff, row.run, activeEpisode)) overriddenUnchanged += 1;
      const promotionBedId =
        findPlannedBedByEpisode(checkedDiff, activeEpisode) ??
        principalBedByRun.get(run) ??
        current.bedId;
      const promotedCrib = promotedCribs.get(promotionBedId);
      if (promotedCrib && unchangedCribEpisodes.has(promotedCrib.source?.encounterId ?? '')) {
        overriddenUnchanged += 1;
      }
      discharges.push({
        // The report label may already show a later physical placement. Application still targets
        // the currently occupied HHR bed; its confirmed provisional move was removed above.
        bedId: current.bedId,
        rut: record.beds[current.bedId]?.rut || row.run,
        patientName: current.patientName,
        kind: mapped.kind,
        status: mapped.status,
        reason: 'administrative-discharge',
        encounterId: row.encounterId ?? current.clinicalEpisodeId,
        expectedOccupant: {
          clinicalEpisodeId: current.clinicalEpisodeId,
          rut: current.rut ?? row.run,
          admissionDate: current.admissionDate,
          admissionTime: current.admissionTime,
        },
        verification: confirmHospitalDischarge(pending?.verification),
        ...correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime),
      });
      continue;
    }
    const currentCrib = findOccupiedClinicalCrib(occupiedCribs, row.run, row.encounterId);
    if (currentCrib) {
      const reportedEpisode = String(row.encounterId ?? '').trim();
      const activeSnapshotCrib = checkedDiff.activeClinicalCribs?.find(
        crib =>
          crib.source.encounterId === reportedEpisode ||
          (Boolean(run) && normalizeRut(crib.patient.rut) === run)
      );
      const activeEpisode =
        [
          activeSnapshotCrib?.source.encounterId,
          activeSnapshotCrib?.patient.clinicalEpisodeId,
          currentCrib.patient.clinicalEpisodeId,
        ]
          .map(value => String(value ?? '').trim())
          .find(Boolean) ?? '';
      if (reportedEpisode && reportedEpisode !== activeEpisode) {
        if (!activeEpisode)
          conflicts.push({
            bedId: currentCrib.parentBedId,
            rut: currentCrib.patient.rut,
            patientName: currentCrib.patient.patientName,
            reason:
              'El egreso identifica un episodio, pero el episodio activo de la cuna no se pudo confirmar.',
          });
        else if (!hasRecordedMovement(record, row.run, reportedEpisode)) {
          reportEgresos.push(reportEgresoFromRow(row));
        }
        continue;
      }
      const parentRun = normalizeRut(currentCrib.parent.rut),
        parentEpisode = currentCrib.parent.clinicalEpisodeId?.trim() ?? '';
      if (!reportConfirmsEpisode(parentRun, currentCrib.parent.clinicalEpisodeId)) {
        const parentMove = checkedDiff.moves.find(
          entry =>
            entry.fromBedId === currentCrib.parentBedId ||
            (Boolean(parentEpisode) && entry.source?.encounterId === parentEpisode)
        );
        const targetBedId = parentMove?.toBedId ?? currentCrib.parentBedId;
        const source =
          checkedDiff.pendingAdministrativeDischarges.find(
            entry =>
              entry.encounterId === reportedEpisode ||
              (Boolean(run) && normalizeRut(entry.rut) === run)
          )?.source ??
          checkedDiff.activeClinicalCribs?.find(
            crib =>
              crib.source.encounterId === reportedEpisode ||
              (Boolean(run) && normalizeRut(crib.patient.rut) === run)
          )?.source;
        updates.push({
          bedId: targetBedId,
          rut: currentCrib.patient.rut,
          patientName: currentCrib.patient.patientName,
          changes: [
            {
              field: 'clinicalCrib',
              from: currentCrib.patient,
              to: undefined,
            },
          ],
          patient: { ...currentCrib.parent, bedId: targetBedId },
          source,
        });
      }
      const encounterId = row.encounterId ?? currentCrib.patient.clinicalEpisodeId;
      if (hasRecordedMovement(record, row.run, encounterId)) continue;
      reportEgresos.push(
        reportEgresoFromRow({
          ...row,
          run: currentCrib.patient.rut || row.run,
          encounterId,
        })
      );
      continue;
    }
    if (hasRecordedMovement(record, row.run, row.encounterId)) continue;
    reportEgresos.push(reportEgresoFromRow(row));
  }
  for (const row of supplemental) {
    if (!hasRecordedMovement(record, row.run, row.encounterId)) {
      reportEgresos.push(reportEgresoFromRow(row));
    }
  }
  const finalDischarges = finalizeDischargePlan(checkedDiff, discharges, record);
  const releasedBeds = resolveReleasedBedPlacements(
    admissions,
    moves,
    discharges,
    dropRedundantUnverifiedReportConflicts(conflicts, finalDischarges, record, reportEgresos)
  );
  const promotedMoveBySource = new Map(
    releasedBeds.promotedMoves.map(move => [move.fromBedId, move])
  );
  const relocatedPendingDischarges = pendingAdministrativeDischarges.map(entry => {
    const move = promotedMoveBySource.get(entry.bedId);
    if (!move) return entry;
    const pendingEpisode = entry.encounterId ?? entry.source?.encounterId;
    const samePatient = pendingEpisode
      ? move.source.encounterId === pendingEpisode
      : normalizeRut(move.rut) === normalizeRut(entry.rut);
    return samePatient ? { ...entry, bedId: move.toBedId } : entry;
  });
  return {
    ...checkedDiff,
    admissions: releasedBeds.admissions,
    updates,
    moves: releasedBeds.moves,
    discharges: finalDischarges,
    pendingAdministrativeDischarges: relocatedPendingDischarges,
    conflicts: releasedBeds.conflicts,
    reportEgresos,
    unchangedCount: Math.max(0, checkedDiff.unchangedCount - overriddenUnchanged),
    summary: {
      ...checkedDiff.summary,
      admissions: releasedBeds.admissions.length,
      updates: updates.length,
      moves: releasedBeds.moves.length,
      discharges: finalDischarges.length,
      pendingAdministrativeDischarges: relocatedPendingDischarges.length,
      conflicts: releasedBeds.conflicts.length,
      unchanged: Math.max(0, checkedDiff.summary.unchanged - overriddenUnchanged),
    },
  };
};
