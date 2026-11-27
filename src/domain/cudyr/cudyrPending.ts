import { getNextDay, NIGHT_SHIFT_START_MINUTES } from '@/utils/clinicalDayUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export type CudyrPendingPhase = 'scheduled' | 'application_window' | 'overdue';

export interface CudyrPendingStatus {
  phase: CudyrPendingPhase;
  label: string;
  detail: string;
}

const CUDYR_WAITING_LABEL = 'Programado · turno noche';

const rapaNuiClock = (now: Date): { day: string; minutes: number } => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(now);
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  return { day: iso, minutes: hours * 60 + minutes };
};

const formatIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-');
  return `${day}-${month}-${year}`;
};

/** Human status for an eligible census patient whose CUDYR has no valid result for that night. */
export const resolveCudyrPendingStatus = (
  censusIsoDay: string,
  now: Date = new Date()
): CudyrPendingStatus => {
  const current = rapaNuiClock(now);
  const applicationDay = getNextDay(censusIsoDay);
  const censusLabel = formatIsoDay(censusIsoDay);
  const applicationLabel = formatIsoDay(applicationDay);
  if (
    current.day < censusIsoDay ||
    (current.day === censusIsoDay && current.minutes < NIGHT_SHIFT_START_MINUTES)
  ) {
    return {
      phase: 'scheduled',
      label: CUDYR_WAITING_LABEL,
      detail: `Aún no corresponde aplicarlo. El CUDYR del ${censusLabel} se completa durante el turno noche y en horario diferido hasta las 11:59 del ${applicationLabel}.`,
    };
  }
  if (
    current.day === censusIsoDay ||
    (current.day === applicationDay && current.minutes < 12 * 60)
  ) {
    return {
      phase: 'application_window',
      label: CUDYR_WAITING_LABEL,
      detail: `Turno noche en curso o registro diferido hasta las 11:59 del ${applicationLabel}. Se sincronizará cuando el CUDYR sea registrado en Eloísa.`,
    };
  }
  return {
    phase: 'overdue',
    label: 'Sin registro',
    detail: `No se encontró un CUDYR válido para el turno noche del ${censusLabel}. Requiere revisión o regularización.`,
  };
};
