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
import { useWoundCarePhotos } from '@/features/wound-care/hooks/useWoundCarePhotos';
import { useWoundCareConsent } from '@/features/wound-care/hooks/useWoundCareConsent';

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

  it.each(['episode', 'hospital'] as const)(
    'isolates both subscriptions on %s changes and rejects late callbacks',
    kind => {
      const photoCallbacks: Array<(value: WoundCarePhoto[]) => void> = [];
      const consentCallbacks: Array<(value: WoundCareConsent | null) => void> = [];
      const stopPhotos = vi.fn();
      const stopConsent = vi.fn();
      const photoPort = {
        ...defaultWoundCarePhotoPort,
        subscribeByEpisode: vi.fn<typeof defaultWoundCarePhotoPort.subscribeByEpisode>(
          (_key, callback) => {
            photoCallbacks.push(callback);
            return stopPhotos;
          }
        ),
      };
      const consentPort = {
        ...defaultWoundCareConsentPort,
        subscribeByEpisode: vi.fn<typeof defaultWoundCareConsentPort.subscribeByEpisode>(
          (_key, callback) => {
            consentCallbacks.push(callback);
            return stopConsent;
          }
        ),
      };
      const { result, rerender, unmount } = renderHook(
        ({ episodeKey, hospitalId }) => ({
          photos: useWoundCarePhotos({ episodeKey, hospitalId, photoPort }),
          consent: useWoundCareConsent({ episodeKey, hospitalId, consentPort }),
        }),
        { initialProps: { episodeKey: 'episode-a', hospitalId: 'hospital-a' } }
      );
      act(() => {
        photoCallbacks[0](photos);
        consentCallbacks[0](consent);
      });
      expect(result.current.consent.consent).toEqual(consent);
      rerender({
        episodeKey: kind === 'episode' ? 'episode-b' : 'episode-a',
        hospitalId: kind === 'hospital' ? 'hospital-b' : 'hospital-a',
      });
      expect(result.current.photos.photos).toEqual([]);
      expect(result.current.consent.consent).toBeNull();
      act(() => {
        photoCallbacks[0](photos);
        consentCallbacks[0](consent);
      });
      expect(result.current.photos.isLoading).toBe(true);
      expect(result.current.consent.isLoading).toBe(true);
      act(() => {
        photoCallbacks[1]([]);
        consentCallbacks[1](null);
      });
      expect(result.current.photos.isLoading).toBe(false);
      expect(result.current.consent.isLoading).toBe(false);
      rerender({ episodeKey: 'episode-a', hospitalId: 'hospital-a' });
      expect(result.current.photos.photos).toEqual([]);
      expect(result.current.consent.consent).toBeNull();
      expect(result.current.photos.isLoading).toBe(true);
      expect(result.current.consent.isLoading).toBe(true);
      unmount();
      expect(stopPhotos).toHaveBeenCalledTimes(3);
      expect(stopConsent).toHaveBeenCalledTimes(3);
    }
  );
});
