import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWoundCareHistory } from '@/features/wound-care/hooks/useWoundCareHistory';
import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
} from '@/features/wound-care/use-cases/woundCarePort';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';

const { mockWoundCareHistoryLogger } = vi.hoisted(() => ({
  mockWoundCareHistoryLogger: vi.fn(),
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock({ error: mockWoundCareHistoryLogger });
});

const sampleActor = {
  uid: 'u-1',
  email: 'enfermeria@hospital.cl',
  displayName: 'Enfermería Prueba',
  role: 'nurse_hospital',
};

const samplePhoto: WoundCarePhoto = {
  id: 'photo-1',
  patientRut: '11111111-1',
  patientName: 'Paciente Sintético',
  episodeKey: 'episode-1',
  storagePath: 'photos/1.webp',
  thumbnailStoragePath: 'photos/1-thumb.webp',
  downloadUrl: 'https://example.test/1.webp',
  thumbnailDownloadUrl: 'https://example.test/1-thumb.webp',
  mimeType: 'image/webp',
  originalFileSize: 5000,
  compressedFileSize: 1000,
  width: 800,
  height: 600,
  description: 'Curación inicial',
  takenAt: '2026-04-01T10:00:00Z',
  uploadedAt: '2026-04-01T10:05:00Z',
  uploadedBy: sampleActor,
  isDeleted: false,
};

const sampleConsent: WoundCareConsent = {
  id: 'consent-1',
  patientRut: '11111111-1',
  patientName: 'Paciente Sintético',
  episodeKey: 'episode-1',
  status: 'signed',
  consentFileStoragePath: 'consents/c1.pdf',
  consentFileDownloadUrl: 'https://example.test/c1.pdf',
  consentFileMimeType: 'application/pdf',
  consentFileSize: 2048,
  signedAt: '2026-04-01T09:00:00Z',
  uploadedAt: '2026-04-01T09:05:00Z',
  uploadedBy: sampleActor,
};

describe('useWoundCareHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs fetch failures through the structured logger, sets photosError, and preserves consents', async () => {
    const historyError = new Error('history failed');
    const photoPort = {
      listByPatientRut: vi.fn().mockRejectedValue(historyError),
    } as unknown as WoundCarePhotoPort;
    const consentPort = {
      listByPatientRut: vi.fn().mockResolvedValue([sampleConsent]),
    } as unknown as WoundCareConsentPort;

    const { result } = renderHook(() =>
      useWoundCareHistory({
        patientRut: '11111111-1',
        currentEpisodeKey: 'episode-1',
        photoPort,
        consentPort,
      })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockWoundCareHistoryLogger).toHaveBeenCalledWith(
      'Error loading wound care history',
      historyError
    );
    expect(result.current.photosError).toMatch(/no fue posible cargar las fotografías/i);
    expect(result.current.consentsError).toBeNull();
    expect(result.current.allConsents).toEqual([sampleConsent]);
    expect(result.current.episodes).toEqual([
      expect.objectContaining({
        episodeKey: 'episode-1',
        isCurrent: true,
        photos: [],
        consent: sampleConsent,
      }),
    ]);
  });

  it('preserves photos when consents fail and catches synchronous port throws', async () => {
    const syncConsentError = new Error('sync consent crash');
    const photoPort = {
      listByPatientRut: vi.fn().mockResolvedValue([samplePhoto]),
    } as unknown as WoundCarePhotoPort;
    const consentPort = {
      listByPatientRut: vi.fn().mockImplementation(() => {
        throw syncConsentError;
      }),
    } as unknown as WoundCareConsentPort;

    const { result } = renderHook(() =>
      useWoundCareHistory({
        patientRut: '11111111-1',
        currentEpisodeKey: 'episode-1',
        photoPort,
        consentPort,
      })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockWoundCareHistoryLogger).toHaveBeenCalledWith(
      'Error loading wound care history',
      syncConsentError
    );
    expect(result.current.photosError).toBeNull();
    expect(result.current.consentsError).toMatch(/no fue posible verificar el consentimiento/i);
    expect(result.current.allPhotos).toEqual([samplePhoto]);
    expect(result.current.allConsents).toEqual([]);
  });

  it('preserves previously loaded branch data when a subsequent reload partially fails and clears errors on recovery', async () => {
    const listPhotos = vi
      .fn()
      .mockResolvedValueOnce([samplePhoto])
      .mockRejectedValueOnce(new Error('temporary photos outage'))
      .mockResolvedValueOnce([samplePhoto]);
    const listConsents = vi
      .fn()
      .mockResolvedValueOnce([sampleConsent])
      .mockResolvedValueOnce([sampleConsent])
      .mockResolvedValueOnce([sampleConsent]);

    const photoPort = { listByPatientRut: listPhotos } as unknown as WoundCarePhotoPort;
    const consentPort = { listByPatientRut: listConsents } as unknown as WoundCareConsentPort;

    const { result } = renderHook(() =>
      useWoundCareHistory({
        patientRut: '11111111-1',
        currentEpisodeKey: 'episode-1',
        photoPort,
        consentPort,
      })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allPhotos).toEqual([samplePhoto]);
    expect(result.current.photosError).toBeNull();

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.photosError).not.toBeNull());
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.allPhotos).toEqual([samplePhoto]);
    expect(result.current.allConsents).toEqual([sampleConsent]);
    expect(result.current.consentsError).toBeNull();

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.photosError).toBeNull());
    expect(result.current.allPhotos).toEqual([samplePhoto]);
  });

  it('clears errors immediately and discards stale responses when switching patients', async () => {
    let resolveStalePhotos!: (value: WoundCarePhoto[]) => void;
    let rejectStaleConsents!: (reason?: unknown) => void;
    const stalePhotos = new Promise<WoundCarePhoto[]>(resolve => {
      resolveStalePhotos = resolve;
    });
    const staleConsents = new Promise<WoundCareConsent[]>((_, reject) => {
      rejectStaleConsents = reject;
    });

    const listPhotos = vi
      .fn()
      .mockRejectedValueOnce(new Error('patient A photos failed'))
      .mockReturnValueOnce(stalePhotos)
      .mockResolvedValueOnce([]);
    const listConsents = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(staleConsents)
      .mockResolvedValueOnce([]);

    const photoPort = { listByPatientRut: listPhotos } as unknown as WoundCarePhotoPort;
    const consentPort = { listByPatientRut: listConsents } as unknown as WoundCareConsentPort;

    const { result, rerender } = renderHook(
      ({ patientRut, currentEpisodeKey }) =>
        useWoundCareHistory({
          patientRut,
          currentEpisodeKey,
          photoPort,
          consentPort,
        }),
      {
        initialProps: {
          patientRut: '11111111-1',
          currentEpisodeKey: 'episode-1',
        },
      }
    );

    await waitFor(() => expect(result.current.photosError).not.toBeNull());

    // Start reload on patient A, then switch to patient B before it settles.
    act(() => {
      result.current.reload();
    });

    rerender({ patientRut: '22222222-2', currentEpisodeKey: 'episode-2' });
    expect(result.current.photosError).toBeNull();
    expect(result.current.consentsError).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      resolveStalePhotos([samplePhoto]);
      rejectStaleConsents(new Error('stale patient A consent error'));
    });

    expect(result.current.allPhotos).toEqual([]);
    expect(result.current.photosError).toBeNull();
    expect(result.current.consentsError).toBeNull();
  });
});
