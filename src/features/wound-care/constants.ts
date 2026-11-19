/**
 * Wound Care Module Constants
 */

// ============================================================================
// File Constraints
// ============================================================================

/** Max file size before compression (15 MB) */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

// Compression parameters live with the shared compression utility in
// src/utils/imageCompression.ts so the utility stays self-contained and
// does not reach back into this feature module.

// ============================================================================
// Accepted MIME Types
// ============================================================================

/** Image types accepted for wound care photos (includes HEIC for iOS) */
export const ACCEPTED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** File types accepted for consent documents (images + PDF) */
export const ACCEPTED_CONSENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

// ============================================================================
// PDF
// ============================================================================

export const HOSPITAL_LOGO_PATH = '/images/logos/logo_HHR.png';
export const HOSPITAL_NAME = 'HOSPITAL HANGA ROA';
export const HOSPITAL_SUBTITLE = 'Servicio de Salud Metropolitano Oriente';
export const HOSPITAL_LOCATION = 'Rapa Nui, Chile';
