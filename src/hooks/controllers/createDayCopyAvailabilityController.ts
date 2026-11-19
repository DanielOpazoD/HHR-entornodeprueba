import { formatCensusMonthName } from '@/shared/census/censusPresentation';
import { resolveClinicalDayBounds } from '@/utils/clinicalDayScheduleUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
import { getTodayISO } from '@/utils/dateCoreUtils';

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
  const { dayStart } = resolveClinicalDayBounds(currentDateString);
  const unlockAt = clinicalWallClockToDate(currentDateString, dayStart);
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

  const { dayStart } = resolveClinicalDayBounds(currentDateString);
  return availability.isTargetToday
    ? `Disponible hoy desde las ${dayStart} hrs.`
    : `Disponible desde el ${formattedDate} a las ${dayStart} hrs.`;
};
