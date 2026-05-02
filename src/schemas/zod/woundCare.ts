/**
 * Zod Validation Schemas for Wound Care Photo Documentation
 */

import { z } from 'zod';
import { nullableOptional } from './helpers';

// ============================================================================
// Audit Actor
// ============================================================================

export const WoundCareAuditActorSchema = z.object({
  uid: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.string(),
});

// ============================================================================
// Consent
// ============================================================================

export const ConsentStatusSchema = z.enum(['pending', 'signed', 'revoked']);

export const WoundCareConsentSchema = z
  .object({
    id: z.string(),
    patientRut: z.string(),
    patientName: z.string(),
    episodeKey: z.string(),
    status: ConsentStatusSchema,
    consentFileStoragePath: z.string(),
    consentFileDownloadUrl: z.string(),
    consentFileMimeType: z.string(),
    consentFileSize: z.number(),
    signedAt: z.string(),
    uploadedAt: z.string(),
    uploadedBy: WoundCareAuditActorSchema,
    revokedAt: nullableOptional(z.string()),
    revokedBy: nullableOptional(WoundCareAuditActorSchema),
    revocationReason: nullableOptional(z.string()),
  })
  .passthrough();

// ============================================================================
// Photo
// ============================================================================

export const WoundCarePhotoSchema = z
  .object({
    id: z.string(),
    patientRut: z.string(),
    patientName: z.string(),
    episodeKey: z.string(),
    consentId: nullableOptional(z.string()),
    storagePath: z.string(),
    thumbnailStoragePath: z.string(),
    downloadUrl: z.string(),
    thumbnailDownloadUrl: z.string(),
    mimeType: z.string(),
    originalFileSize: z.number(),
    compressedFileSize: z.number(),
    width: z.number(),
    height: z.number(),
    description: nullableOptional(z.string()),
    bodyLocation: nullableOptional(z.string()),
    takenAt: z.string(),
    uploadedAt: z.string(),
    uploadedBy: WoundCareAuditActorSchema,
    uploadedViaSessionId: nullableOptional(z.string()),
    deletedAt: nullableOptional(z.string()),
    deletedBy: nullableOptional(WoundCareAuditActorSchema),
    isDeleted: z.boolean().default(false),
  })
  .passthrough();

// ============================================================================
// Mobile QR Upload Session
// ============================================================================

export const WoundCareMobileUploadSessionSchema = z
  .object({
    sessionId: z.string(),
    hospitalId: z.string(),
    episodeKey: z.string(),
    patientRut: z.string(),
    patientName: z.string(),
    createdBy: WoundCareAuditActorSchema,
    createdAt: z.string(),
    expiresAt: z.string(),
    scope: z.literal('wound_care_upload_only'),
    revokedAt: nullableOptional(z.string()),
    revokedBy: nullableOptional(WoundCareAuditActorSchema),
  })
  .passthrough();

// ============================================================================
// Parse helpers
// ============================================================================

export const parseWoundCareConsent = (data: unknown) => WoundCareConsentSchema.parse(data);
export const safeParseWoundCareConsent = (data: unknown) => WoundCareConsentSchema.safeParse(data);
export const parseWoundCarePhoto = (data: unknown) => WoundCarePhotoSchema.parse(data);
export const safeParseWoundCarePhoto = (data: unknown) => WoundCarePhotoSchema.safeParse(data);
export const parseWoundCareMobileUploadSession = (data: unknown) =>
  WoundCareMobileUploadSessionSchema.parse(data);
export const safeParseWoundCareMobileUploadSession = (data: unknown) =>
  WoundCareMobileUploadSessionSchema.safeParse(data);
