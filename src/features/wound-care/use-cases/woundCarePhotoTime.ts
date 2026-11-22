/**
 * Wound Care Photo Time
 *
 * `takenAt` is the hospital wall-clock time of the photo (Rapa Nui), written as
 * `YYYY-MM-DDTHH:mm:00.000Z`. The trailing `Z` is a legacy marker, not UTC: the digits are what
 * the nurse saw or typed. Photos saved without a time of their own stored the upload instant
 * instead (`takenAt === uploadedAt`, both in the app and in the mobile upload Function); those,
 * and photos without `takenAt`, are real instants and are read on the hospital clock. Nothing
 * stored is rewritten.
 */

import type { WoundCarePhoto, WoundCarePhotoSession } from '@/types/domain/woundCare';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export interface WoundCarePhotoWallClock {
  /** Hospital calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Hospital wall-clock time, `HH:mm`; empty when the stored value is unreadable. */
  time: string;
}

const fromInstant = (value: string): WoundCarePhotoWallClock => {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: value.slice(0, 10), time: '' };
  const { iso, hhmm } = calendarStampInClinicalTimeZone(instant);
  return { date: iso, time: hhmm };
};

/** Hospital date and time a photo belongs to, whichever way its time was stored. */
export const resolvePhotoWallClock = (
  photo: Pick<WoundCarePhoto, 'takenAt' | 'uploadedAt'>
): WoundCarePhotoWallClock => {
  const { takenAt, uploadedAt } = photo;
  if (!takenAt || takenAt === uploadedAt) return fromInstant(takenAt || uploadedAt);
  // clinical-clock-allow instant-calendar-slice: takenAt distinct from uploadedAt stores hospital wall time, including its legacy Z marker (#954).
  return { date: takenAt.slice(0, 10), time: takenAt.slice(11, 16) };
};

/** `takenAt` for a photo taken at `now`: the hospital wall clock in the stored format. */
export const hospitalTakenAt = (now: Date = new Date()): string => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(now);
  return `${iso}T${hhmm}:00.000Z`;
};

/** Sessions by hospital date, most recent first; each session in the order photos were taken. */
export const groupPhotosByDate = (photos: WoundCarePhoto[]): WoundCarePhotoSession[] => {
  const groups = new Map<string, { photo: WoundCarePhoto; takenAt: string }[]>();

  for (const photo of photos) {
    const { date, time } = resolvePhotoWallClock(photo);
    const entries = groups.get(date) ?? [];
    entries.push({ photo, takenAt: `${date}T${time}` });
    groups.set(date, entries);
  }

  return Array.from(groups.entries())
    .map(([date, entries]) => ({
      date,
      photos: entries
        .sort(
          (a, b) =>
            a.takenAt.localeCompare(b.takenAt) ||
            a.photo.uploadedAt.localeCompare(b.photo.uploadedAt)
        )
        .map(entry => entry.photo),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
};
