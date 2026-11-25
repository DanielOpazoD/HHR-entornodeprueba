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
import { WoundCarePhotoRepository } from '@/features/wound-care/services/WoundCarePhotoRepository';

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

  it('lists patient history without requiring a composite uploadedAt index', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValue([
      buildPhoto('older', '2026-05-02T10:00:00.000Z'),
      buildPhoto('newer', '2026-05-02T11:00:00.000Z'),
    ]);

    const result = await WoundCarePhotoRepository.listByPatientRut('11.111.111-1', 'H1');

    expect(firestoreDb.getDocs).toHaveBeenCalledWith('hospitals/H1/woundCarePhotos', {
      where: [
        { field: 'patientRut', operator: '==', value: '11.111.111-1' },
        { field: 'isDeleted', operator: '==', value: false },
      ],
    });
    expect(result.map(photo => photo.id)).toEqual(['newer', 'older']);
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
