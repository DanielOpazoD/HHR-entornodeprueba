/**
 * Zod Validation Schemas for Wound Care Photo Documentation
 */

import * as z from 'zod';
import { nullableOptional, StringSchema, NullableOptionalStringSchema } from './helpers';

// ============================================================================
// Audit Actor
// ============================================================================

export const WoundCareAuditActorSchema = z.object({
  uid: StringSchema,
  email: StringSchema,
  displayName: StringSchema,
  role: StringSchema,
});

const OptionalWoundCareAuditActorSchema = nullableOptional(WoundCareAuditActorSchema);

// ============================================================================
// Consent
// ============================================================================

export const ConsentStatusSchema = z.enum(['pending', 'signed', 'revoked']);

export const WoundCareConsentSchema = z
  .object({
    id: StringSchema,
    patientRut: StringSchema,
    patientName: StringSchema,
    episodeKey: StringSchema,
    status: ConsentStatusSchema,
    consentFileStoragePath: StringSchema,
    consentFileDownloadUrl: StringSchema,
    consentFileMimeType: StringSchema,
    consentFileSize: z.number(),
    signedAt: StringSchema,
    uploadedAt: StringSchema,
    uploadedBy: WoundCareAuditActorSchema,
    revokedAt: NullableOptionalStringSchema,
    revokedBy: OptionalWoundCareAuditActorSchema,
    revocationReason: NullableOptionalStringSchema,
  })
  .passthrough();

// ============================================================================
// Photo
// ============================================================================

export const WoundCarePhotoSchema = z
  .object({
    id: StringSchema,
    patientRut: StringSchema,
    patientName: StringSchema,
    episodeKey: StringSchema,
    consentId: NullableOptionalStringSchema,
    storagePath: StringSchema,
    thumbnailStoragePath: StringSchema,
    downloadUrl: StringSchema,
    thumbnailDownloadUrl: StringSchema,
    mimeType: StringSchema,
    originalFileSize: z.number(),
    compressedFileSize: z.number(),
    width: z.number(),
    height: z.number(),
    description: NullableOptionalStringSchema,
    bodyLocation: NullableOptionalStringSchema,
    takenAt: StringSchema,
    uploadedAt: StringSchema,
    uploadedBy: WoundCareAuditActorSchema,
    uploadedViaSessionId: NullableOptionalStringSchema,
    deletedAt: NullableOptionalStringSchema,
    deletedBy: OptionalWoundCareAuditActorSchema,
    isDeleted: z.boolean().prefault(false),
  })
  .passthrough();

// ============================================================================
// Mobile QR Upload Session
// ============================================================================

export const WoundCareMobileUploadSessionSchema = z
  .object({
    sessionId: StringSchema,
    hospitalId: StringSchema,
    episodeKey: StringSchema,
    patientRut: StringSchema,
    patientName: StringSchema,
    createdBy: WoundCareAuditActorSchema,
    createdAt: StringSchema,
    expiresAt: StringSchema,
    scope: z.literal('wound_care_upload_only'),
    revokedAt: NullableOptionalStringSchema,
    revokedBy: OptionalWoundCareAuditActorSchema,
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
