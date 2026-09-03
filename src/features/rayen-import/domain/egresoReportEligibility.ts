import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { EgresoReportRow } from '../contracts/egresoReport';
import { normalizeRut } from '@/utils/rutUtils';
import { eligibleExactEpisodes, findPlannedPatientByEpisode } from './egresoReportEvidence';
import {
  correctedStamp,
  episodeLessReportConflict,
  findOccupiedClinicalCrib,
  hasRecordedMovement,
  occupiedBedsByRun,
  occupiedClinicalCribsByRun,
  reportPredatesActiveAdmission,
  resolveActiveEpisode,
  toIsoDay,
} from './egresoReportPolicy';
import { appendReportConflict } from './egresoReportConflicts';
import { resolveReportedOccupant } from './reportedOccupant';

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
  // Filas del RUN que este mismo bucle NO descarta (estampa válida y dentro del
  // día): una fila D+1 real o inválida no debe retener la etiqueta de redundancia.
  const stampedRowsByRun = new Map<string, number>();
  for (const row of reportRows) {
    const rowRun = normalizeRut(row.run);
    const stamped = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
    const withinDay =
      Boolean(stamped.correctedDay && stamped.correctedTime) &&
      Boolean(recordDay && stamped.correctedDay && stamped.correctedDay <= recordDay);
    if (rowRun && withinDay) stampedRowsByRun.set(rowRun, (stampedRowsByRun.get(rowRun) ?? 0) + 1);
  }

  for (const row of reportRows) {
    const run = normalizeRut(row.run);
    const reportedEpisode = String(row.encounterId ?? '').trim();
    if (!run && !reportedEpisode) continue;

    const current = resolveReportedOccupant(occupied, occupiedCribs, row.run, reportedEpisode);
    const currentCrib = findOccupiedClinicalCrib(occupiedCribs, row.run, reportedEpisode);
    const normalized = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
    const stamp =
      normalized.correctedDay && normalized.correctedTime
        ? { iso: normalized.correctedDay, hhmm: normalized.correctedTime }
        : null;
    if (!stamp) {
      // Con cama conocida el conflicto se aísla a esa cama; sin cama ni episodio, la
      // convergencia clínica bloquea todo el censo a propósito (no puede aislarse).
      nextDiff = appendReportConflict(nextDiff, {
        bedId: current?.bedId ?? currentCrib?.parentBedId ?? null,
        patientName: current?.patientName ?? currentCrib?.patient.patientName ?? row.patientName,
        rut: row.run,
        reason: `El informe de Gestión de Camas contiene una fecha/hora de egreso inválida para el RUN ${run}; no se aplicó.`,
      });
      continue;
    }
    // The D+1 query compensates Rayen's offset; genuine next-day discharges stay excluded.
    if (!recordDay || stamp.iso > recordDay) continue;

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
    if (row.exactEpisodeVerification === 'unverified') {
      // Etiqueta estable: applyEgresoReport descarta esta revisión si el pipeline
      // termina construyendo el egreso de esa cama/RUN por el lookup exacto (visto
      // en vivo el 02-09: RN bajo el RUN de la madre → dos filas, vinculación
      // ambigua, alta aplicada y conflicto falso). Con más filas de las que la
      // cama explica (gemelos) la revisión se conserva sin etiqueta.
      const bedId = current?.bedId ?? currentCrib?.parentBedId ?? null;
      const cribOccupied = Boolean(bedId && record.beds[bedId]?.clinicalCrib?.patientName?.trim());
      const rowsSharingRun = run ? (stampedRowsByRun.get(run) ?? 1) : 1;
      // Nota: una fila 'unverified' nunca trae episodio con el productor actual
      // (enrichReportOnlyDischarges deja sin estado a las filas con episodio); si
      // algún día lo trajera, la fila del RN resolvería solo la cuna (explained 1)
      // y su conflicto quedaría sin etiqueta frente al de la madre (explained 2).
      const explainedByBed = (current ? 1 : 0) + (cribOccupied ? 1 : 0);
      const redundancyCandidate = Boolean(bedId) && rowsSharingRun <= explainedByBed;
      nextDiff = appendReportConflict(nextDiff, {
        bedId,
        ...(redundancyCandidate ? { code: 'unverified-report-row' as const } : {}),
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
        code: 'report-predates-admission',
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
      nextDiff = appendReportConflict(nextDiff, {
        ...episodeConflict,
        code: 'episode-less-report-row',
      });
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
