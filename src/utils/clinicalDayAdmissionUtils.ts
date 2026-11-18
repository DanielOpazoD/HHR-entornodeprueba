import { normalizeDateOnly } from './clinicalDateUtils';
import {
  getPreviousDay,
  NIGHT_SHIFT_START_MINUTES,
  parseTimeMinutes,
  resolveClinicalDayBounds,
} from './clinicalDayScheduleUtils';
import type { ShiftType } from '@/types/domain/shift';

import { calendarStampInClinicalTimeZone } from './clinicalTimeZone';

/** Clinical day (08:00 weekday / 09:00 weekend rollover) resolved on the hospital wall clock. */
export const resolveCurrentClinicalDay = (now: Date = new Date()): string => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(now);
  return resolveClinicalDayForDateTime(iso, hhmm) ?? iso;
};

/**
 * The shift running at an instant on the hospital wall clock (Rapa Nui), whatever the device
 * zone: day from that day's day-shift start (08:00 business day, 09:00 weekend or holiday) until
 * 20:00, night otherwise.
 */
export const getCurrentShift = (now: Date = new Date()): ShiftType => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(now);
  const minutes = parseTimeMinutes(hhmm) ?? 0;
  const { dayStartMinutes } = resolveClinicalDayBounds(iso);
  return minutes >= dayStartMinutes && minutes < NIGHT_SHIFT_START_MINUTES ? 'day' : 'night';
};

export const resolveClinicalDayForDateTime = (
  eventDate?: string,
  eventTime?: string
): string | undefined => {
  const normalizedEventDate = normalizeDateOnly(eventDate);
  if (!normalizedEventDate) {
    return undefined;
  }

  const eventTimeMinutes = parseTimeMinutes(eventTime);
  if (eventTimeMinutes === null) {
    return normalizedEventDate;
  }

  const { dayStartMinutes } = resolveClinicalDayBounds(normalizedEventDate);
  return eventTimeMinutes < dayStartMinutes
    ? getPreviousDay(normalizedEventDate)
    : normalizedEventDate;
};

export const isNewAdmissionForClinicalDay = (
  recordDate: string,
  admissionDate?: string,
  admissionTime?: string
): boolean => {
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  if (!normalizedRecordDate || !normalizedAdmissionDate) {
    return false;
  }

  if (parseTimeMinutes(admissionTime) === null) {
    const { nextDay } = resolveClinicalDayBounds(normalizedRecordDate);
    return normalizedAdmissionDate === nextDay;
  }

  const clinicalAdmissionDate = resolveClinicalDayForDateTime(
    normalizedAdmissionDate,
    admissionTime
  );
  if (!clinicalAdmissionDate) {
    return false;
  }

  return clinicalAdmissionDate === normalizedRecordDate;
};

export const isAdmittedDuringShift = (
  recordDate: string,
  admissionDate?: string,
  admissionTime?: string,
  shift: 'day' | 'night' = 'day'
): boolean => {
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);

  if (!normalizedAdmissionDate || !normalizedRecordDate) return true;
  if (normalizedAdmissionDate < normalizedRecordDate) return true;

  const admissionTimeMinutes = parseTimeMinutes(admissionTime);
  const { nextDay, nightEndMinutes } = resolveClinicalDayBounds(normalizedRecordDate);

  if (shift === 'day') {
    if (normalizedAdmissionDate === normalizedRecordDate) {
      if (admissionTimeMinutes === null) return true;
      return admissionTimeMinutes < NIGHT_SHIFT_START_MINUTES;
    }
    return false;
  }

  if (normalizedAdmissionDate === normalizedRecordDate) {
    return true;
  }

  if (normalizedAdmissionDate === nextDay) {
    if (admissionTimeMinutes === null) return true;
    return admissionTimeMinutes < nightEndMinutes;
  }

  return false;
};
