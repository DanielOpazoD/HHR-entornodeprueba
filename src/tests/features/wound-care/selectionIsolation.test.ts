import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  WoundCarePhoto,
  WoundCareConsent,
  WoundCareAuditActor,
} from '@/types/domain/woundCare';
import {
  defaultWoundCarePhotoPort,
  defaultWoundCareConsentPort,
} from '@/application/ports/woundCarePort';
import { useWoundCareHistory } from '@/features/wound-care/hooks/useWoundCareHistory';

const buildPhoto = (id: string, uploadedAt: string): WoundCarePhoto => ({
  id,
  patientRut: '11.111.111-1',
  patientName: 'Paciente Test',
  episodeKey: '11111111-1__2026-05-02',
  storagePath: `wound-care/photos/${id}.webp`,
  thumbnailStoragePath: `wound-care/thumbnails/${id}.webp`,
  downloadUrl: `https://example.test/${id}.webp`,
  thumbnailDownloadUrl: `https://example.test/${id}_thumb.webp`,
  mimeType: 'image/webp',
  originalFileSize: 1000,
  compressedFileSize: 500,
  width: 800,
  height: 600,
  takenAt: uploadedAt,
  uploadedAt,
  uploadedBy: {
    uid: 'u1',
    email: 'test@hospital.cl',
    displayName: 'Usuario Test',
    role: 'admin',
  },
  isDeleted: false,
});

const mockActor: WoundCareAuditActor = {
  uid: 'u1',
  email: 'e@e.cl',
  displayName: 'Test',
  role: 'editor',
};

const makeConsent = (status: 'pending' | 'signed' | 'revoked'): WoundCareConsent => ({
  id: 'c1',
  patientRut: '1-1',
  patientName: 'P',
  episodeKey: 'ep',
  status,
  consentFileStoragePath: 'p',
  consentFileDownloadUrl: 'u',
  consentFileMimeType: 'application/pdf',
  consentFileSize: 100,
  signedAt: '2026-01-01T00:00:00Z',
  uploadedAt: '2026-01-01T00:00:00Z',
  uploadedBy: mockActor,
  ...(status === 'revoked'
    ? {
        revokedAt: '2026-01-02T00:00:00Z',
        revokedBy: mockActor,
        revocationReason: 'Revocado por paciente',
      }
    : {}),
});

const photos = [buildPhoto('photo-a', '2026-05-02T10:00:00Z')];
const consent = makeConsent('signed');

describe('wound care selection isolation', () => {
  it('hides patient history immediately when selection changes or disappears', async () => {
    let resolveNext!: (value: WoundCarePhoto[]) => void;
    const photoPort = {
      ...defaultWoundCarePhotoPort,
      listByPatientRut: vi
        .fn()
        .mockResolvedValueOnce(photos)
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              resolveNext = resolve;
            })
        ),
    };
    const consentPort = {
      ...defaultWoundCareConsentPort,
      listByPatientRut: vi.fn().mockResolvedValue([consent]),
    };
    const { result, rerender } = renderHook(
      ({ patientRut }: { patientRut: string | undefined }) =>
        useWoundCareHistory({ patientRut, currentEpisodeKey: 'current', photoPort, consentPort }),
      { initialProps: { patientRut: 'patient-a' as string | undefined } }
    );
    await act(async () => {});
    expect(result.current.allPhotos).toEqual(photos);
    rerender({ patientRut: 'patient-b' });
    expect(result.current.allPhotos).toEqual([]);
    expect(result.current.allConsents).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    rerender({ patientRut: undefined });
    await act(async () => {
      resolveNext(photos);
    });
    expect(result.current.allPhotos).toEqual([]);
    expect(result.current.allConsents).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
