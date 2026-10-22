/**
 * Photo Upload Controller
 *
 * Pure logic for photo upload validation and metadata preparation.
 */

import { validatePhotoFile, validateConsentFile } from '../domain/woundCareValidation';
import type { FileValidationResult } from '../domain/woundCareValidation';
import { hospitalTakenAt } from '@/application/wound-care/woundCarePhotoTime';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export interface UploadProgress {
  stage: 'validating' | 'compressing' | 'uploading' | 'saving' | 'done' | 'error';
  message: string;
}

export const UPLOAD_PROGRESS_MESSAGES: Record<UploadProgress['stage'], string> = {
  validating: 'Validando archivo...',
  compressing: 'Comprimiendo imagen...',
  uploading: 'Subiendo al servidor...',
  saving: 'Guardando registro...',
  done: 'Fotografía guardada correctamente.',
  error: 'Error al subir la fotografía.',
};

/** Validate a photo file against accepted types and size limits before upload. */
export const validatePhotoForUpload = (file: File): FileValidationResult => validatePhotoFile(file);

/** Validate a consent file against accepted types and size limits before upload. */
export const validateConsentForUpload = (file: File): FileValidationResult =>
  validateConsentFile(file);

/** Format a byte count into a human-readable string (B / KB / MB). */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Format the compression ratio as a percentage reduction string (e.g. "72% reduccion"). */
export const formatCompressionRatio = (original: number, compressed: number): string => {
  if (original === 0) return '0%';
  const ratio = ((1 - compressed / original) * 100).toFixed(0);
  return `${ratio}% reducción`;
};

/** Default and maximum of the photo time field: the hospital wall clock, not the device's. */
export const toClinicalDatetimeLocalValue = (date: Date = new Date()): string =>
  hospitalTakenAt(date).slice(0, 16);

/**
 * `takenAt` from the time field (hospital wall clock, see woundCarePhotoTime). An emptied field
 * still records the hospital time of the upload instead of leaving the server a UTC instant.
 */
export const toClinicalEventIso = (datetimeLocalValue: string, now: Date = new Date()): string =>
  datetimeLocalValue.trim() ? `${datetimeLocalValue}:00.000Z` : hospitalTakenAt(now);

export const formatReadonlyUploadDateTime = (date: Date = new Date()): string => {
  const { iso, hhmm } = calendarStampInClinicalTimeZone(date);
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year} ${hhmm}`;
};
