// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  WoundCareConsentSchema,
  WoundCarePhotoSchema,
  safeParseWoundCareConsent,
  safeParseWoundCarePhoto,
} from '@/schemas/zod/woundCare';

const validActor = {
  uid: 'user-1',
  email: 'nurse@hospital.cl',
  displayName: 'Enfermera Test',
  role: 'editor',
};

describe('WoundCareConsentSchema', () => {
  const validConsent = {
    id: 'consent-1',
    patientRut: '12345678-9',
    patientName: 'Paciente Test',
    episodeKey: '12345678-9__2026-01-15',
    status: 'signed',
    consentFileStoragePath: 'wound-care/consents/path',
    consentFileDownloadUrl: 'https://storage.test/consent.pdf',
    consentFileMimeType: 'application/pdf',
    consentFileSize: 1024,
    signedAt: '2026-01-15T10:00:00Z',
    uploadedAt: '2026-01-15T10:00:00Z',
    uploadedBy: validActor,
  };

  it('parses valid consent', () => {
    const result = WoundCareConsentSchema.safeParse(validConsent);
    expect(result.success).toBe(true);
  });

  it('accepts consent with optional revocation fields', () => {
    const result = WoundCareConsentSchema.safeParse({
      ...validConsent,
      status: 'revoked',
      revokedAt: '2026-01-16T10:00:00Z',
      revokedBy: validActor,
      revocationReason: 'Patient requested',
    });
    expect(result.success).toBe(true);
  });

  it('handles null optional fields', () => {
    const result = WoundCareConsentSchema.safeParse({
      ...validConsent,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = safeParseWoundCareConsent({
      ...validConsent,
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = safeParseWoundCareConsent({
      id: 'c1',
      patientRut: '1-1',
      // missing episodeKey, status, etc.
    });
    expect(result.success).toBe(false);
  });

  it('preserves unknown fields (passthrough)', () => {
    const result = WoundCareConsentSchema.safeParse({
      ...validConsent,
      futureField: 'value',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).futureField).toBe('value');
    }
  });
});

describe('WoundCarePhotoSchema', () => {
  const validPhoto = {
    id: 'photo-1',
    patientRut: '12345678-9',
    patientName: 'Paciente Test',
    episodeKey: '12345678-9__2026-01-15',
    consentId: undefined,
    storagePath: 'wound-care/photos/path/photo.webp',
    thumbnailStoragePath: 'wound-care/thumbnails/path/photo_thumb.webp',
    downloadUrl: 'https://storage.test/photo.webp',
    thumbnailDownloadUrl: 'https://storage.test/thumb.webp',
    mimeType: 'image/webp',
    originalFileSize: 5000000,
    compressedFileSize: 300000,
    width: 1920,
    height: 1080,
    takenAt: '2026-01-15T10:00:00Z',
    uploadedAt: '2026-01-15T10:00:00Z',
    uploadedBy: validActor,
    isDeleted: false,
  };

  it('parses valid photo', () => {
    const result = WoundCarePhotoSchema.safeParse(validPhoto);
    expect(result.success).toBe(true);
  });

  it('accepts photo with optional fields', () => {
    const result = WoundCarePhotoSchema.safeParse({
      ...validPhoto,
      description: 'Curación herida operatoria',
      bodyLocation: 'Pierna derecha',
    });
    expect(result.success).toBe(true);
  });

  it('defaults isDeleted to false', () => {
    const withoutDeleted = { ...validPhoto };
    delete (withoutDeleted as Record<string, unknown>).isDeleted;

    const result = WoundCarePhotoSchema.safeParse(withoutDeleted);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isDeleted).toBe(false);
    }
  });

  it('handles null optional fields', () => {
    const result = safeParseWoundCarePhoto({
      ...validPhoto,
      description: null,
      bodyLocation: null,
      deletedAt: null,
      deletedBy: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = safeParseWoundCarePhoto({ id: 'p1' });
    expect(result.success).toBe(false);
  });
});
