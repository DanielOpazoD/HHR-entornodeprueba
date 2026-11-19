/**
 * Wound Care Validation Rules
 *
 * Pure validation functions for consent checks, file types, and size limits.
 */

import {
  ACCEPTED_PHOTO_MIME_TYPES,
  ACCEPTED_CONSENT_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '../constants';

// ============================================================================
// File Validation
// ============================================================================

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export const validatePhotoFile = (file: File): FileValidationResult => {
  if (!ACCEPTED_PHOTO_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `Tipo de archivo no soportado: ${file.type || 'desconocido'}. Use JPEG, PNG, WebP o HEIC.`,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `El archivo es demasiado grande (${sizeMB} MB). Máximo permitido: 15 MB.`,
    };
  }

  return { valid: true };
};

export const validateConsentFile = (file: File): FileValidationResult => {
  if (!ACCEPTED_CONSENT_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `Tipo de archivo no soportado: ${file.type || 'desconocido'}. Use PDF, JPEG, PNG, WebP o HEIC.`,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `El archivo es demasiado grande (${sizeMB} MB). Máximo permitido: 15 MB.`,
    };
  }

  return { valid: true };
};

// ============================================================================
// Body Location Options
// ============================================================================

export const BODY_LOCATION_OPTIONS = [
  'Cabeza',
  'Cuello',
  'Tórax anterior',
  'Tórax posterior',
  'Abdomen',
  'Espalda',
  'Brazo derecho',
  'Brazo izquierdo',
  'Antebrazo derecho',
  'Antebrazo izquierdo',
  'Mano derecha',
  'Mano izquierda',
  'Muslo derecho',
  'Muslo izquierdo',
  'Pierna derecha',
  'Pierna izquierda',
  'Pie derecho',
  'Pie izquierdo',
  'Glúteo derecho',
  'Glúteo izquierdo',
  'Sacro',
  'Otro',
] as const;
