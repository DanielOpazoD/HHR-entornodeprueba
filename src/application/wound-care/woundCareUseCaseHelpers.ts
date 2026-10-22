/**
 * Internal helpers shared by wound-care use case modules.
 *
 * Re-exported through woundCareUseCases.ts for the single public surface;
 * individual use-case modules (consent, photo) import from here directly.
 */

import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
  WoundCareStoragePort,
} from '@/application/ports/woundCarePort';
import { getTodayISO } from '@/utils/dateCoreUtils';

export interface EpisodeContext {
  episodeKey: string;
  patientRut: string;
  patientName: string;
}

export interface WoundCareConsentDeps {
  consentPort?: WoundCareConsentPort;
  storagePort?: WoundCareStoragePort;
}

export interface WoundCarePhotoDeps {
  photoPort?: WoundCarePhotoPort;
  consentPort?: WoundCareConsentPort;
  storagePort?: WoundCareStoragePort;
}

export const generateId = (): string => crypto.randomUUID();

export const todayDateString = (): string => getTodayISO();

export const extractFileExtension = (file: File): string => {
  const parts = file.name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'bin';
};

export const buildConsentStoragePath = (
  hospitalId: string,
  patientRut: string,
  episodeKey: string,
  consentId: string,
  extension: string
): string =>
  `wound-care/consents/${hospitalId}/${patientRut}/${episodeKey}/${consentId}.${extension}`;

export const buildPhotoStoragePath = (
  hospitalId: string,
  patientRut: string,
  episodeKey: string,
  date: string,
  photoId: string
): string => `wound-care/photos/${hospitalId}/${patientRut}/${episodeKey}/${date}/${photoId}.webp`;

export const buildThumbnailStoragePath = (
  hospitalId: string,
  patientRut: string,
  episodeKey: string,
  date: string,
  photoId: string
): string =>
  `wound-care/thumbnails/${hospitalId}/${patientRut}/${episodeKey}/${date}/${photoId}_thumb.webp`;
