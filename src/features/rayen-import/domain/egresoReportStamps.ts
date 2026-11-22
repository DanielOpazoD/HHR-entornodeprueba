import type { EgresoReportRow, ReportEgreso } from '../contracts/egresoReport';
import { isCmaBedLabel, isCmaLocation } from '../mapping/bedMapping';
import { mapDestinoDeAlta } from '../mapping/mapDestinoDeAlta';
import { toTitleCaseName } from '../mapping/rayenToPatientData';
import type { CorrectedEgresoFields } from '../mapping/reportEgresoDateTime';
import { officialCalendarDay, parseStatisticalEgresoStamp } from '../mapping/reportEgresoDateTime';
import { resolveReportBedId } from '../mapping/resolveReportBed';
import { calendarDateForMovement } from '@/utils/movementCalendarDate';

export interface CmaOriginEvidence {
  admissionDate?: string;
  admissionTime?: string;
  location?: string;
}

/** A report stamp: its census day, time and, when the source supplied it, its calendar day. */
export interface ReportEgresoStamp {
  iso: string;
  hhmm: string;
  calendarIso?: string;
}

/**
 * Two rows of one egreso keep their existing order (`key`: later wins, the first stays on a tie).
 * Only on that tie does a valid official calendar day decide: Friday and Saturday 08:30 share the
 * Friday census and time, and the stored date must not depend on which row arrived first.
 */
export const isLaterEgresoRow = (
  key: string,
  calendarDay: string | undefined,
  priorKey: string,
  priorCalendarDay: string | undefined
): boolean =>
  key > priorKey || (key === priorKey && (calendarDay ?? '') > (priorCalendarDay ?? ''));

export const correctedStamp = (
  fechaEgreso: string,
  correctedDay?: string,
  correctedTime?: string,
  correctedCalendarDay?: string
): CorrectedEgresoFields => {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(correctedDay || '');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(correctedTime || '');
  const date =
    dayMatch &&
    new Date(Date.UTC(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3])));
  const isValidDay = Boolean(
    dayMatch &&
    date &&
    date.getUTCFullYear() === Number(dayMatch[1]) &&
    date.getUTCMonth() === Number(dayMatch[2]) - 1 &&
    date.getUTCDate() === Number(dayMatch[3])
  );
  const isValidTime = Boolean(
    timeMatch && Number(timeMatch[1]) <= 23 && Number(timeMatch[2]) <= 59
  );
  if (isValidDay && isValidTime) {
    const calendarDay = officialCalendarDay(correctedDay, correctedTime, correctedCalendarDay);
    return {
      correctedDay,
      correctedTime,
      ...(calendarDay && { correctedCalendarDay: calendarDay }),
    };
  }
  const stamp = parseStatisticalEgresoStamp(fechaEgreso);
  return stamp
    ? {
        correctedDay: stamp.iso,
        correctedTime: stamp.hhmm,
        correctedCalendarDay: stamp.calendarIso,
      }
    : { correctedDay: undefined, correctedTime: undefined };
};

export const toIsoDay = (raw: string): string => {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  const [, day, month, year] = dmy ?? [];
  if (day && month && year) return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return '';
};

const timeFrom = (raw?: string): string | undefined => {
  // clinical-clock-allow raw-offset-clock: Report scale and discharge clocks are already unzoned hospital-local evidence.
  const match = (raw ?? '').match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

export const reportPredatesAdmission = (
  stamp: ReportEgresoStamp,
  evidence: CmaOriginEvidence
): boolean => {
  const admissionDay = toIsoDay(evidence.admissionDate ?? '');
  if (!admissionDay) return false;
  // The report stamp owns a census shift; admissionDate is a calendar date.
  const dischargeCalendarDay = stamp.calendarIso ?? calendarDateForMovement(stamp.iso, stamp.hhmm);
  if (dischargeCalendarDay !== admissionDay) return dischargeCalendarDay < admissionDay;
  const admissionTime = timeFrom(evidence.admissionTime) ?? timeFrom(evidence.admissionDate);
  return admissionTime ? stamp.hhmm < admissionTime : false;
};

export const resolveReportDischarge = (row: EgresoReportRow, evidence: CmaOriginEvidence = {}) => {
  const mapped = mapDestinoDeAlta(row.destino, row.motivo);
  mapped.status = row.dischargeStatus ?? mapped.status;
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
    status: row.dischargeStatus ?? mapped.status,
    edad: row.edad,
    servicio: row.servicio,
    diagnostico: row.diagnostico,
    admissionDay: row.admissionDay,
    admissionTime: row.admissionTime,
    ...correctedStamp(
      row.fechaEgreso,
      row.correctedDay,
      row.correctedTime,
      row.correctedCalendarDay
    ),
  };
};
