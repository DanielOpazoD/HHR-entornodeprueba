/**
 * Wound Care Timeline Builder
 *
 * Pure function that groups photos into date-based sessions
 * for chronological display.
 */

import type { WoundCareConsent, WoundCarePhoto, WoundCareTimeline } from '@/types/domain/woundCare';
import { groupPhotosByDate } from './woundCarePhotoTime';

interface EpisodeContext {
  episodeKey: string;
  patientRut: string;
  patientName: string;
}

/**
 * Build a complete timeline for a patient's hospitalization episode.
 */
export const buildWoundCareTimeline = (
  photos: WoundCarePhoto[],
  consent: WoundCareConsent | null,
  episodeContext: EpisodeContext
): WoundCareTimeline => ({
  episodeKey: episodeContext.episodeKey,
  patientRut: episodeContext.patientRut,
  patientName: episodeContext.patientName,
  consent,
  sessions: groupPhotosByDate(photos),
  totalPhotos: photos.length,
});
