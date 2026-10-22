import { formatCensusMonthName } from '@/shared/census/censusPresentation';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
import { getTodayISO } from '@/utils/dateCoreUtils';

/** Hospital hour at which the night shift has handed over and the day can be copied. */
export const COPY_PREVIOUS_DAY_UNLOCK_HOUR = 8;
const COPY_UNLOCK_TIME = `${String(COPY_PREVIOUS_DAY_UNLOCK_HOUR).padStart(2, '0')}:00`;

export interface CreateDayCopyAvailability {
  isCopyLocked: boolean;
  unlockAt: Date | null;
  remainingMs: number;
  countdownLabel: string | null;
  isTargetToday: boolean;
}

export const formatCopyUnlockCountdown = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
};

export const resolveCreateDayCopyAvailability = (
  currentDateString: string,
  now: Date = new Date()
): CreateDayCopyAvailability => {
  const todayString = getTodayISO(now);

  if (currentDateString < todayString) {
    return {
      isCopyLocked: false,
      unlockAt: null,
      remainingMs: 0,
      countdownLabel: null,
      isTargetToday: false,
    };
  }

  // On the hospital clock: a mainland device would otherwise unlock two hours early.
  const unlockAt = clinicalWallClockToDate(currentDateString, COPY_UNLOCK_TIME);
  const remainingMs = Math.max(0, unlockAt.getTime() - now.getTime());
  const isCopyLocked = remainingMs > 0;

  return {
    isCopyLocked,
    unlockAt,
    remainingMs,
    countdownLabel: isCopyLocked ? formatCopyUnlockCountdown(remainingMs) : null,
    isTargetToday: currentDateString === todayString,
  };
};

export const buildCopyUnlockDescription = (
  currentDateString: string,
  now: Date = new Date()
): string => {
  const availability = resolveCreateDayCopyAvailability(currentDateString, now);
  const [, , day] = currentDateString.split('-');
  const capitalizedMonthName = formatCensusMonthName(currentDateString);
  const formattedDate = `${parseInt(day, 10)} de ${capitalizedMonthName}`;

  return availability.isTargetToday
    ? `Disponible hoy desde las ${COPY_PREVIOUS_DAY_UNLOCK_HOUR}:00 hrs.`
    : `Disponible desde el ${formattedDate} a las ${COPY_PREVIOUS_DAY_UNLOCK_HOUR}:00 hrs.`;
};
