/**
 * Photo Gallery Controller
 *
 * Pure presentation helpers for the wound care photo gallery.
 */

import { resolvePhotoWallClock } from '@/application/wound-care/woundCarePhotoTime';
import type { WoundCarePhoto, WoundCarePhotoSession } from '@/types/domain/woundCare';

/**
 * Format a date string for display in the gallery header.
 */
export const formatSessionDate = (dateStr: string): string => {
  try {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
};

/**
 * Hospital wall-clock time (HH:mm) the photo was taken at, whatever the device time zone.
 */
export const formatPhotoTime = (photo: Pick<WoundCarePhoto, 'takenAt' | 'uploadedAt'>): string =>
  resolvePhotoWallClock(photo).time;

/**
 * Get a summary string for a photo session.
 */
export const formatSessionSummary = (session: WoundCarePhotoSession): string => {
  const count = session.photos.length;
  return count === 1 ? '1 foto' : `${count} fotos`;
};
