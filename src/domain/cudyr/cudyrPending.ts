import { getNextDay } from '@/utils/clinicalDayUtils';

export type CudyrPendingPhase = 'scheduled' | 'application_window' | 'overdue';

export interface CudyrPendingStatus {
  phase: CudyrPendingPhase;
  label: string;
  detail: string;
}

const rapaNuiClock = (now: Date): { day: string; minutes: number } => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
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
  if (current.day < censusIsoDay || (current.day === censusIsoDay && current.minutes < 20 * 60)) {
    return {
      phase: 'scheduled',
      label: 'Programado',
      detail: `Aún no corresponde aplicarlo. El CUDYR del ${censusLabel} se completa durante el turno noche y la madrugada del ${applicationLabel}.`,
    };
  }
  if (
    current.day === censusIsoDay ||
    (current.day === applicationDay && current.minutes < 12 * 60)
  ) {
    return {
      phase: 'application_window',
      label: 'Pendiente',
      detail: `Turno noche en curso. Se sincronizará cuando el CUDYR sea registrado en Eloísa durante la madrugada del ${applicationLabel}.`,
    };
  }
  return {
    phase: 'overdue',
    label: 'Sin registro',
    detail: `No se encontró un CUDYR válido para el turno noche del ${censusLabel}. Requiere revisión o regularización.`,
  };
};
