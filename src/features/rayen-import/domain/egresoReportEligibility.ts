import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import { normalizeRut } from '@/utils/rutUtils';
import { eligibleExactEpisodes, findPlannedPatientByEpisode } from './egresoReportEvidence';
import {
  correctedStamp,
  episodeLessReportConflict,
  findOccupiedBed,
  findOccupiedClinicalCrib,
  hasRecordedMovement,
  occupiedBedsByRun,
  occupiedClinicalCribsByRun,
  reportPredatesActiveAdmission,
  resolveActiveEpisode,
  toIsoDay,
} from './egresoReportPolicy';
import { appendReportConflict } from './egresoReportConflicts';

type EligibilityResult = {
  diff: CensusImportDiff;
  rows: EgresoReportRow[];
};

export type PromotionCandidate = {
  principalRut?: string;
  patient: NonNullable<DailyRecord['beds'][string]>;
  source?: CensusImportDiff['admissions'][number]['source'];
};

/**
 * Filters report rows that have enough episode and temporal evidence to affect the census.
 * Invalid or ambiguous rows stay visible as review conflicts instead of vacating a bed.
 */
export const selectEligibleEgresoRows = (
  diff: CensusImportDiff,
  reportRows: EgresoReportRow[],
  record: DailyRecord
): EligibilityResult => {
  const recordDay = toIsoDay(record.date);
  const exactEpisodes = eligibleExactEpisodes(reportRows, recordDay);
  const occupied = occupiedBedsByRun(record);
  const occupiedCribs = occupiedClinicalCribsByRun(record);
  const rows: EgresoReportRow[] = [];
  let nextDiff = diff;

  for (const row of reportRows) {
    const run = normalizeRut(row.run);
    const reportedEpisode = String(row.encounterId ?? '').trim();
    if (!run && !reportedEpisode) continue;

    const normalized = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
    const stamp =
      normalized.correctedDay && normalized.correctedTime
        ? { iso: normalized.correctedDay, hhmm: normalized.correctedTime }
        : null;
    if (!stamp) {
      nextDiff = appendReportConflict(nextDiff, {
        bedId: null,
        rut: row.run,
        reason: `El informe de Gestión de Camas contiene una fecha/hora de egreso inválida para el RUN ${run}; no se aplicó.`,
      });
      continue;
    }
    // The D+1 query compensates Rayen's offset; genuine next-day discharges stay excluded.
    if (!recordDay || stamp.iso > recordDay) continue;

    const current = findOccupiedBed(occupied, row.run, reportedEpisode);
    const currentCrib = findOccupiedClinicalCrib(occupiedCribs, row.run, reportedEpisode);
    const activeCrib = diff.activeClinicalCribs?.find(
      crib =>
        (Boolean(reportedEpisode) && crib.source.encounterId === reportedEpisode) ||
        (Boolean(run) && normalizeRut(crib.patient.rut) === run)
    );
    const provisional = diff.admissions.find(
      entry =>
        (Boolean(reportedEpisode) && entry.source?.encounterId === reportedEpisode) ||
        (Boolean(run) && normalizeRut(entry.patient.rut) === run)
    );
    // El informe de Gestión de Camas re-enumera las altas del día completo: un
    // paciente ya egresado en HHR es historia aplicada, no un cambio nuevo.
    // Antes, cuando la vinculación exacta degradaba (lookup ambiguo, PDF no
    // disponible), estas filas reaparecían como «no pudo vincularse…» en cada
    // re-sincronización. El descarte exige que el RUN no tenga presencia
    // actual NI pendiente (cama, cuna, ingreso del diff): un reingreso en
    // vuelo conserva la exigencia de revisión. Con episodio exacto solo cuenta
    // un movimiento de ESE episodio (un movimiento legacy por RUN no debe
    // suprimir el egreso de un reingreso posterior).
    const alreadyRecorded = reportedEpisode
      ? hasRecordedMovement(record, '', reportedEpisode)
      : Boolean(run) && hasRecordedMovement(record, run);
    if (!current && !currentCrib && !activeCrib && !provisional && alreadyRecorded) continue;
    // El censo de Ficha Médico ya planifica el egreso de este RUN/episodio (su
    // evidencia de Gestión de Camas se usó para confirmarlo): la fila del
    // informe es redundante, no un cambio nuevo. Con un RN registrado bajo el
    // RUN de la madre, el informe trae DOS filas con el mismo RUN, la
    // vinculación exacta queda ambigua ('unverified') y se exigía revisión de
    // un alta que sí se aplicaba (visto en vivo el 02-09: H5C1 madre + cuna,
    // corrida «Parcial» con banner por un conflicto falso). La cuna sale como
    // alta asociada con la madre (alta, vivo); si no, se conserva la revisión.
    if (row.exactEpisodeVerification === 'unverified') {
      const plannedDischarge = diff.discharges.find(
        entry =>
          (Boolean(reportedEpisode) &&
            (entry.encounterId === reportedEpisode ||
              entry.source?.encounterId === reportedEpisode)) ||
          (Boolean(run) && normalizeRut(entry.rut) === run)
      );
      const cribRidesAlong =
        !currentCrib ||
        (plannedDischarge?.kind === 'alta' &&
          plannedDischarge.status === 'Vivo' &&
          Boolean(record.beds[plannedDischarge.bedId]?.clinicalCrib));
      if (plannedDischarge && cribRidesAlong) continue;
    }
    if (row.exactEpisodeVerification === 'unverified') {
      nextDiff = appendReportConflict(nextDiff, {
        bedId: current?.bedId ?? currentCrib?.parentBedId ?? null,
        rut: row.run,
        patientName: current?.patientName ?? currentCrib?.patient.patientName ?? row.patientName,
        reason: `El alta administrativa de ${current?.patientName ?? currentCrib?.patient.patientName ?? row.patientName} no pudo vincularse a un episodio clínico exacto; no se aplicó.`,
      });
      continue;
    }
    const exactEvidence = reportedEpisode
      ? (diff.activeClinicalCribs?.find(crib => crib.source.encounterId === reportedEpisode)
          ?.patient ??
        findPlannedPatientByEpisode(diff, record, reportedEpisode) ??
        (current?.clinicalEpisodeId === reportedEpisode ? record.beds[current.bedId] : undefined) ??
        (currentCrib?.patient.clinicalEpisodeId === reportedEpisode
          ? currentCrib.patient
          : undefined))
      : undefined;
    const admissionEvidence =
      exactEvidence ??
      current ??
      currentCrib?.patient ??
      activeCrib?.patient ??
      provisional?.patient;
    if (reportPredatesActiveAdmission(diff, row, run, stamp, admissionEvidence)) {
      const activeEpisode = resolveActiveEpisode(diff, run, admissionEvidence?.clinicalEpisodeId);
      // An episode-less discharge from before a known readmission cannot refer to the
      // active hospitalization. Keep the active bed and ignore the historical evidence.
      if (!reportedEpisode && activeEpisode) continue;
      nextDiff = appendReportConflict(nextDiff, {
        bedId: current?.bedId ?? currentCrib?.parentBedId ?? null,
        rut: row.run,
        patientName: current?.patientName ?? currentCrib?.patient.patientName,
        reason: `El egreso informado para ${current?.patientName ?? currentCrib?.patient.patientName ?? row.patientName} es anterior a su ingreso activo; no se desocupó la cama.`,
      });
      continue;
    }

    const activeEpisode = current?.clinicalEpisodeId ?? currentCrib?.patient.clinicalEpisodeId;
    const exactSibling =
      !reportedEpisode && Boolean(activeEpisode && exactEpisodes.has(activeEpisode));
    const episodeConflict = exactSibling
      ? null
      : episodeLessReportConflict(diff, record, row, current, currentCrib);
    if (episodeConflict) {
      nextDiff = appendReportConflict(nextDiff, episodeConflict);
      continue;
    }
    const verifiedRun =
      exactEvidence?.rut ??
      (!reportedEpisode
        ? current
          ? record.beds[current.bedId]?.rut
          : currentCrib?.patient.rut
        : undefined);
    rows.push(verifiedRun ? { ...row, run: verifiedRun } : row);
  }

  return { diff: nextDiff, rows };
};
