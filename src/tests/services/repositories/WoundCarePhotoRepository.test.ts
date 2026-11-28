// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WoundCarePhoto } from '@/types/domain/woundCare';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    subscribeQuery: vi.fn(),
  },
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

import { firestoreDb } from '@/services/storage/firestore';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { WoundCarePhotoRepository } from '@/features/wound-care/services/WoundCarePhotoRepository';
import { WoundCareConsentRepository } from '@/features/wound-care/services/WoundCareConsentRepository';
import type { WoundCareConsent } from '@/types/domain/woundCare';

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

describe('WoundCarePhotoRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists patient history from server without requiring isDeleted in the Firestore query filter', async () => {
    const legacyWithoutIsDeleted = {
      ...buildPhoto('legacy-no-flag', '2026-05-02T10:30:00.000Z'),
    } as Record<string, unknown>;
    delete legacyWithoutIsDeleted.isDeleted;

    vi.mocked(firestoreDb.getDocs).mockResolvedValue([
      buildPhoto('older', '2026-05-02T10:00:00.000Z'),
      legacyWithoutIsDeleted as unknown as WoundCarePhoto,
      { ...buildPhoto('deleted', '2026-05-02T10:45:00.000Z'), isDeleted: true },
      buildPhoto('newer', '2026-05-02T11:00:00.000Z'),
    ]);

    const result = await WoundCarePhotoRepository.listByPatientRut('11.111.111-1', 'H1');

    expect(firestoreDb.getDocs).toHaveBeenCalledWith('hospitals/H1/woundCarePhotos', {
      where: [{ field: 'patientRut', operator: '==', value: '11.111.111-1' }],
      source: 'server',
    });
    expect(result.map(photo => photo.id)).toEqual(['newer', 'legacy-no-flag', 'older']);
    expect(result.find(photo => photo.id === 'legacy-no-flag')?.isDeleted).toBe(false);
  });

  it('keeps the episode gallery, subscription and count consistent for a legacy photo', async () => {
    const { isDeleted: _flag, ...legacy } = buildPhoto('legacy', '2026-04-01T10:00:00Z');
    const deleted = { ...legacy, id: 'deleted', isDeleted: true };
    const rows = [legacy, deleted];
    vi.mocked(firestoreDb.getDocs).mockResolvedValue(rows);
    const callback = vi.fn();
    const gallery = await WoundCarePhotoRepository.listByEpisode(legacy.episodeKey, 'H1');
    WoundCarePhotoRepository.subscribeByEpisode(legacy.episodeKey, callback, 'H1');
    const [path, selection, emit] = vi.mocked(firestoreDb.subscribeQuery).mock.calls[0]!;
    expect(selection.where).toEqual([
      { field: 'episodeKey', operator: '==', value: legacy.episodeKey },
    ]);
    expect(firestoreDb.getDocs).toHaveBeenCalledWith(path, selection);
    emit(rows);
    expect(callback).toHaveBeenCalledWith(gallery);
    expect(gallery.map(photo => photo.id)).toEqual(['legacy']);
    expect(await WoundCarePhotoRepository.countByEpisodeKeys([legacy.episodeKey], 'H1')).toEqual({
      [legacy.episodeKey]: 1,
    });
  });

  it('fails closed in listByPatientRut when an active photo record fails schema validation', async () => {
    const malformedPhoto = {
      ...buildPhoto('broken', '2026-05-02T10:00:00.000Z'),
      width: undefined,
    } as unknown as WoundCarePhoto;
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([malformedPhoto]);

    await expect(WoundCarePhotoRepository.listByPatientRut('11.111.111-1', 'H1')).rejects.toThrow(
      /no se pudieron validar 1 fotografía/i
    );
    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'photo_repository_invalid_read_record',
      })
    );
  });

  it('reads consents from server and fails closed when a consent record fails schema validation', async () => {
    const validConsent: WoundCareConsent = {
      id: 'c-1',
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11111111-1__2026-05-02',
      status: 'signed',
      consentFileStoragePath: 'consents/c-1.pdf',
      consentFileDownloadUrl: 'https://example.test/c-1.pdf',
      consentFileMimeType: 'application/pdf',
      consentFileSize: 2048,
      signedAt: '2026-05-02T09:00:00.000Z',
      uploadedAt: '2026-05-02T09:05:00.000Z',
      uploadedBy: {
        uid: 'u1',
        email: 'test@hospital.cl',
        displayName: 'Usuario Test',
        role: 'admin',
      },
    };

    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([validConsent]);
    const consents = await WoundCareConsentRepository.listByPatientRut('11.111.111-1', 'H1');
    expect(firestoreDb.getDocs).toHaveBeenCalledWith('hospitals/H1/woundCareConsents', {
      where: [{ field: 'patientRut', operator: '==', value: '11.111.111-1' }],
      source: 'server',
    });
    expect(consents).toEqual([validConsent]);

    const malformedConsent = {
      ...validConsent,
      consentFileSize: undefined,
    } as unknown as WoundCareConsent;
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([malformedConsent]);

    await expect(WoundCareConsentRepository.listByPatientRut('11.111.111-1', 'H1')).rejects.toThrow(
      /no se pudieron validar 1 consentimiento/i
    );
    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'consent_repository_invalid_read_record',
      })
    );
  });

  it('counts active valid photos across multiple episodes in chunks of 30 without catching read failures', async () => {
    const validEp1 = buildPhoto('p1', '2026-05-02T10:00:00.000Z');
    const deletedEp1 = { ...buildPhoto('p2', '2026-05-02T10:05:00.000Z'), isDeleted: true };
    const invalidEp2 = {
      ...buildPhoto('p3', '2026-05-02T10:10:00.000Z'),
      episodeKey: 'ep-2',
      width: Number.NaN,
    };
    const validEp2 = { ...buildPhoto('p4', '2026-05-02T10:15:00.000Z'), episodeKey: 'ep-2' };

    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      validEp1,
      deletedEp1,
      invalidEp2,
      validEp2,
    ]);

    const counts = await WoundCarePhotoRepository.countByEpisodeKeys(
      ['11111111-1__2026-05-02', 'ep-2', 'ep-empty', 'ep-2', '  '],
      'H1'
    );

    expect(firestoreDb.getDocs).toHaveBeenCalledTimes(1);
    expect(firestoreDb.getDocs).toHaveBeenCalledWith('hospitals/H1/woundCarePhotos', {
      where: [
        {
          field: 'episodeKey',
          operator: 'in',
          value: ['11111111-1__2026-05-02', 'ep-2', 'ep-empty'],
        },
      ],
    });
    expect(counts).toEqual({
      '11111111-1__2026-05-02': 1,
      'ep-2': 1,
      'ep-empty': 0,
    });

    // Empty input issues zero reads.
    expect(await WoundCarePhotoRepository.countByEpisodeKeys([], 'H1')).toEqual({});
    expect(firestoreDb.getDocs).toHaveBeenCalledTimes(1);

    // >30 episodes split into 2 Firestore `in` chunks.
    const thirtyTwoKeys = Array.from({ length: 32 }, (_, idx) => `ep-${idx}`);
    vi.mocked(firestoreDb.getDocs).mockResolvedValue([]);
    const chunkedCounts = await WoundCarePhotoRepository.countByEpisodeKeys(thirtyTwoKeys, 'H1');
    expect(firestoreDb.getDocs).toHaveBeenCalledTimes(3);
    expect(Object.keys(chunkedCounts)).toHaveLength(32);

    // Failed Firestore read propagates (SAVE-01: never collapses to 0 photos).
    vi.mocked(firestoreDb.getDocs).mockRejectedValueOnce(new Error('offline'));
    await expect(WoundCarePhotoRepository.countByEpisodeKeys(['ep-err'], 'H1')).rejects.toThrow(
      'offline'
    );
  });
});
