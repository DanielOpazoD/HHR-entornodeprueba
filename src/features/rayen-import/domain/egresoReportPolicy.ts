import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import { isCmaBedLabel, isCmaLocation } from '../mapping/bedMapping';
import { mapDestinoDeAlta } from '../mapping/mapDestinoDeAlta';
import { toTitleCaseName } from '../mapping/rayenToPatientData';
import { parseStatisticalEgresoStamp } from '../mapping/reportEgresoDateTime';
import { resolveReportBedId } from '../mapping/resolveReportBed';
import { normalizeRut } from '@/utils/rutUtils';

export interface OccupiedBedEvidence {
  bedId: string;
  patientName: string;
  clinicalEpisodeId?: string;
  admissionDate?: string;
  admissionTime?: string;
  location?: string;
}

export interface OccupiedClinicalCrib {
  parentBedId: string;
  parent: DailyRecord['beds'][string];
  patient: DailyRecord['beds'][string];
}

interface CmaOriginEvidence {
  admissionDate?: string;
  admissionTime?: string;
  location?: string;
}

export const correctedStamp = (
  fechaEgreso: string,
  correctedDay?: string,
  correctedTime?: string
): { correctedDay?: string; correctedTime?: string } => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(correctedDay || '') && /^\d{2}:\d{2}$/.test(correctedTime || '')) {
    return { correctedDay, correctedTime };
  }
  const stamp = parseStatisticalEgresoStamp(fechaEgreso);
  return { correctedDay: stamp?.iso, correctedTime: stamp?.hhmm };
};

export const collectRecordedMovementRuns = (record: DailyRecord): Set<string> => {
  const runs = new Set<string>();
  const add = (rut?: string): void => {
    const run = normalizeRut(rut);
    if (run) runs.add(run);
  };
  for (const movement of [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ]) {
    add(movement.rut);
  }
  return runs;
};

export const hasRecordedMovement = (
  record: DailyRecord,
  run: string,
  encounterId?: string
): boolean => {
  const normalizedRun = normalizeRut(run);
  return [
    ...(record.discharges ?? []),
    ...(record.cma ?? []),
    ...(record.transfers ?? []),
  ].some(movement =>
    normalizeRut(movement.rut) === normalizedRun &&
    (!encounterId || !movement.clinicalEpisodeId || movement.clinicalEpisodeId === encounterId)
  );
};

export const toIsoDay = (raw: string): string => {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
};

const timeFrom = (raw?: string): string | undefined => {
  const match = (raw ?? '').match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

export const reportPredatesAdmission = (
  stamp: { iso: string; hhmm: string },
  evidence: CmaOriginEvidence
): boolean => {
  const admissionDay = toIsoDay(evidence.admissionDate ?? '');
  if (!admissionDay) return false;
  if (stamp.iso !== admissionDay) return stamp.iso < admissionDay;
  const admissionTime = timeFrom(evidence.admissionTime) ?? timeFrom(evidence.admissionDate);
  return admissionTime ? stamp.hhmm < admissionTime : false;
};

export const resolveReportDischarge = (
  row: EgresoReportRow,
  evidence: CmaOriginEvidence = {}
) => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  const dischargeDay = correctedStamp(
    row.fechaEgreso,
    row.correctedDay,
    row.correctedTime
  ).correctedDay;
  const hasExactCmaBed = isCmaLocation(evidence.location) || isCmaBedLabel(row.bedLabel);
  const isSameDayCma =
    mapped.kind === 'alta' &&
    mapped.status === 'Vivo' &&
    hasExactCmaBed &&
    Boolean(evidence.admissionDate) &&
    toIsoDay(evidence.admissionDate ?? '') === dischargeDay;
  return isSameDayCma ? { ...mapped, kind: 'cma' as const } : mapped;
};

export const occupiedBedsByRun = (record: DailyRecord): Map<string, OccupiedBedEvidence> => {
  const byRun = new Map<string, OccupiedBedEvidence>();
  for (const [bedId, patient] of Object.entries(record.beds)) {
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = normalizeRut(patient.rut);
    if (run) {
      byRun.set(run, {
        bedId,
        patientName: patient.patientName,
        clinicalEpisodeId: patient.clinicalEpisodeId,
        admissionDate: patient.admissionDate,
        admissionTime: patient.admissionTime,
        location: patient.location,
      });
    }
  }
  return byRun;
};

export const occupiedClinicalCribsByRun = (
  record: DailyRecord
): Map<string, OccupiedClinicalCrib> => {
  const byRun = new Map<string, OccupiedClinicalCrib>();
  for (const [parentBedId, parent] of Object.entries(record.beds)) {
    const patient = parent?.clinicalCrib;
    if (!patient?.patientName?.trim() || patient.isBlocked) continue;
    const run = normalizeRut(patient.rut);
    if (run) byRun.set(run, { parentBedId, parent, patient });
  }
  return byRun;
};

export const reportEgresoFromRow = (row: EgresoReportRow): ReportEgreso => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  return {
    run: row.run,
    encounterId: row.encounterId,
    patientName: toTitleCaseName(row.patientName.replace(/\s+/g, ' ')),
    bedLabel: resolveReportBedId(row.bedLabel),
    destino: row.destino,
    fechaEgreso: row.fechaEgreso,
    kind: mapped.kind,
    status: mapped.status,
    edad: row.edad,
    servicio: row.servicio,
    diagnostico: row.diagnostico,
    ...correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime),
  };
};
