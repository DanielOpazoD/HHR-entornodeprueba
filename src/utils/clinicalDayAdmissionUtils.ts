import { normalizeDateOnly } from './clinicalDateUtils';
import {
  getPreviousDay,
  parseTimeMinutes,
  resolveClinicalDayBounds,
} from './clinicalDayScheduleUtils';

import { calendarStampInClinicalTimeZone } from './clinicalTimeZone';

/** Clinical day (08:00 weekday / 09:00 weekend rollover) resolved on the hospital wall clock. */
export const resolveCurrentClinicalDay = (now: Date = new Date()): string => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(now);
  return resolveClinicalDayForDateTime(iso, hhmm) ?? iso;
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
  const dayEndMinutes = 20 * 60;
  const { nextDay, nightEndMinutes } = resolveClinicalDayBounds(normalizedRecordDate);

  if (shift === 'day') {
    if (normalizedAdmissionDate === normalizedRecordDate) {
      if (admissionTimeMinutes === null) return true;
      return admissionTimeMinutes < dayEndMinutes;
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
