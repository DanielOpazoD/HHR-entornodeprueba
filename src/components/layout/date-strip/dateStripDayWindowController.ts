import type { ModuleType } from '@/constants/navigationConfig';

export const DATE_STRIP_MOBILE_BREAKPOINT = 640;
export const DATE_STRIP_TABLET_BREAKPOINT = 1024;

const MOBILE_VISIBLE_DAYS = 5;
const TABLET_VISIBLE_DAYS = 7;
const DESKTOP_VISIBLE_DAYS = 13;
const COMPACT_DESKTOP_VISIBLE_DAYS = 9;

const COMPACT_DAY_STRIP_MODULES = new Set<ModuleType>([
  'CENSUS',
  'NURSING_HANDOFF',
  'MEDICAL_HANDOFF',
]);

export interface DateStripDayWindow {
  startDay: number;
  endDay: number;
  visibleDays: number;
}

interface ResolveDateStripDayWindowParams {
  selectedDay: number;
  daysInMonth: number;
  windowWidth: number;
  currentModule?: ModuleType;
}

export const resolveDateStripVisibleDays = (
  windowWidth: number,
  currentModule?: ModuleType
): number => {
  if (windowWidth < DATE_STRIP_MOBILE_BREAKPOINT) {
    return MOBILE_VISIBLE_DAYS;
  }

  if (windowWidth < DATE_STRIP_TABLET_BREAKPOINT) {
    return currentModule && COMPACT_DAY_STRIP_MODULES.has(currentModule) ? 3 : TABLET_VISIBLE_DAYS;
  }

  if (currentModule && COMPACT_DAY_STRIP_MODULES.has(currentModule)) {
    return COMPACT_DESKTOP_VISIBLE_DAYS;
  }

  return DESKTOP_VISIBLE_DAYS;
};

export const resolveDateStripDayWindow = ({
  selectedDay,
  daysInMonth,
  windowWidth,
  currentModule,
}: ResolveDateStripDayWindowParams): DateStripDayWindow => {
  const visibleDays = resolveDateStripVisibleDays(windowWidth, currentModule);
  const offset = Math.floor(visibleDays / 2);

  let startDay = selectedDay - offset;
  let endDay = selectedDay + offset;

  if (startDay < 1) {
    startDay = 1;
    endDay = Math.min(visibleDays, daysInMonth);
  }

  if (endDay > daysInMonth) {
    endDay = daysInMonth;
    startDay = Math.max(1, daysInMonth - visibleDays + 1);
  }

  return {
    startDay,
    endDay,
    visibleDays,
  };
};

const createMaxAllowedDate = (referenceDate: Date): Date => {
  const maxAllowedDate = new Date(referenceDate);
  maxAllowedDate.setHours(0, 0, 0, 0);
  maxAllowedDate.setDate(maxAllowedDate.getDate() + 1);
  return maxAllowedDate;
};

interface ResolveIsFutureDayBlockedParams {
  selectedYear: number;
  selectedMonth: number;
  day: number;
  referenceDate?: Date;
}

export const resolveIsFutureDayBlocked = ({
  selectedYear,
  selectedMonth,
  day,
  referenceDate = new Date(),
}: ResolveIsFutureDayBlockedParams): boolean => {
  const buttonDate = new Date(selectedYear, selectedMonth, day);
  buttonDate.setHours(0, 0, 0, 0);

  return buttonDate > createMaxAllowedDate(referenceDate);
};
