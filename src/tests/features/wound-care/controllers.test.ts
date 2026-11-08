import { describe, it, expect } from 'vitest';
import {
  deriveConsentDisplayState,
  canUploadPhotosFromState,
  consentStatusLabel,
  resolveConsentActionLabel,
} from '@/features/wound-care/controllers/consentStatusController';
import { groupPhotosByDate } from '@/application/wound-care/woundCarePhotoTime';
import {
  formatSessionDate,
  formatPhotoTime,
  formatSessionSummary,
} from '@/features/wound-care/controllers/photoGalleryController';
import {
  formatFileSize,
  formatCompressionRatio,
  formatReadonlyUploadDateTime,
  toClinicalDatetimeLocalValue,
  toClinicalEventIso,
} from '@/features/wound-care/controllers/photoUploadController';
import type {
  WoundCareConsent,
  WoundCarePhoto,
  WoundCareAuditActor,
} from '@/types/domain/woundCare';

// ============================================================================
// Consent Status Controller
// ============================================================================

describe('consentStatusController', () => {
  const mockActor: WoundCareAuditActor = {
    uid: 'u1',
    email: 'e@e.cl',
    displayName: 'Test',
    role: 'editor',
  };

  const baseConsent: WoundCareConsent = {
    id: 'c1',
    patientRut: '1-1',
    patientName: 'P',
    episodeKey: 'ep',
    status: 'signed',
    consentFileStoragePath: 'p',
    consentFileDownloadUrl: 'u',
    consentFileMimeType: 'application/pdf',
    consentFileSize: 100,
    signedAt: '2026-01-01T00:00:00Z',
    uploadedAt: '2026-01-01T00:00:00Z',
    uploadedBy: mockActor,
  };

  it('returns none when consent is null', () => {
    expect(deriveConsentDisplayState(null)).toBe('none');
  });

  it('returns signed when consent status is signed', () => {
    expect(deriveConsentDisplayState(baseConsent)).toBe('signed');
  });

  it('returns revoked when consent status is revoked', () => {
    expect(deriveConsentDisplayState({ ...baseConsent, status: 'revoked' })).toBe('revoked');
  });

  it('canUploadPhotosFromState only true for signed', () => {
    expect(canUploadPhotosFromState('signed')).toBe(true);
    expect(canUploadPhotosFromState('none')).toBe(false);
    expect(canUploadPhotosFromState('revoked')).toBe(false);
  });

  it('provides labels for all states', () => {
    expect(consentStatusLabel.none).toBeTruthy();
    expect(consentStatusLabel.signed).toBeTruthy();
    expect(consentStatusLabel.revoked).toBeTruthy();
  });

  it('resolveConsentActionLabel provides correct labels', () => {
    expect(resolveConsentActionLabel('none')).toBe('Subir consentimiento');
    expect(resolveConsentActionLabel('signed')).toBe('Ver consentimiento');
    expect(resolveConsentActionLabel('revoked')).toBe('Subir nuevo consentimiento');
  });
});

// ============================================================================
// Photo Gallery Controller
// ============================================================================

describe('photoGalleryController', () => {
  const mockActor: WoundCareAuditActor = {
    uid: 'u1',
    email: 'e@e.cl',
    displayName: 'Test',
    role: 'editor',
  };

  const makePhoto = (id: string, uploadedAt: string): WoundCarePhoto => ({
    id,
    patientRut: '1-1',
    patientName: 'P',
    episodeKey: 'ep',
    consentId: 'c1',
    storagePath: 'p',
    thumbnailStoragePath: 't',
    downloadUrl: 'u',
    thumbnailDownloadUrl: 'u',
    mimeType: 'image/webp',
    originalFileSize: 5000,
    compressedFileSize: 1000,
    width: 800,
    height: 600,
    takenAt: uploadedAt,
    uploadedAt,
    uploadedBy: mockActor,
    isDeleted: false,
  });

  it('groups photos by date', () => {
    const photos = [
      makePhoto('p1', '2026-01-15T10:00:00Z'),
      makePhoto('p2', '2026-01-15T14:00:00Z'),
      makePhoto('p3', '2026-01-16T09:00:00Z'),
    ];

    const sessions = groupPhotosByDate(photos);
    expect(sessions).toHaveLength(2);
    // Most recent date first
    expect(sessions[0].date).toBe('2026-01-16');
    expect(sessions[0].photos).toHaveLength(1);
    expect(sessions[1].date).toBe('2026-01-15');
    expect(sessions[1].photos).toHaveLength(2);
  });

  it('returns empty array for no photos', () => {
    expect(groupPhotosByDate([])).toEqual([]);
  });

  it('formats session date', () => {
    expect(formatSessionDate('2026-01-15')).toBe('15/01/2026');
  });

  it('shows the hospital time the photo was taken at, whatever the device clock', () => {
    // Typed in the form: the stored digits are the hospital wall clock.
    expect(
      formatPhotoTime({
        takenAt: '2026-01-15T14:30:00.000Z',
        uploadedAt: '2026-01-15T20:05:12.345Z',
      })
    ).toBe('14:30');
    // Saved without a time of its own: a real instant, read on the hospital clock (UTC-5).
    expect(
      formatPhotoTime({
        takenAt: '2026-01-15T20:05:12.345Z',
        uploadedAt: '2026-01-15T20:05:12.345Z',
      })
    ).toBe('15:05');
  });

  it('formats session summary', () => {
    expect(
      formatSessionSummary({
        date: '2026-01-15',
        photos: [makePhoto('p1', '2026-01-15T10:00:00Z')],
      })
    ).toBe('1 foto');
    expect(
      formatSessionSummary({
        date: '2026-01-15',
        photos: [makePhoto('p1', '2026-01-15T10:00:00Z'), makePhoto('p2', '2026-01-15T11:00:00Z')],
      })
    ).toBe('2 fotos');
  });
});

// ============================================================================
// Photo Upload Controller
// ============================================================================

describe('photoUploadController', () => {
  it('keeps upload date as readonly display and stores editable clinical event datetime', () => {
    // 04:30 UTC on Nov 1 is still 23:30 on Oct 31 at the hospital.
    const lateEvening = new Date('2026-11-01T04:30:00.000Z');
    expect(formatReadonlyUploadDateTime(lateEvening)).toBe('31/10/2026 23:30');
    expect(toClinicalDatetimeLocalValue(lateEvening)).toBe('2026-10-31T23:30');
    expect(toClinicalEventIso('2026-05-01T09:30')).toBe('2026-05-01T09:30:00.000Z');
    // An emptied field still records the hospital time, never a UTC instant.
    expect(toClinicalEventIso('', lateEvening)).toBe('2026-10-31T23:30:00.000Z');
  });

  it('formats file sizes correctly', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1500)).toBe('1.5 KB');
    expect(formatFileSize(2500000)).toBe('2.4 MB');
  });

  it('formats compression ratio', () => {
    expect(formatCompressionRatio(1000, 200)).toBe('80% reducción');
    expect(formatCompressionRatio(0, 0)).toBe('0%');
  });
});
