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
import { WoundCarePhotoRepository } from '@/services/repositories/WoundCarePhotoRepository';

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
});
