import { describe, it, expect, vi } from 'vitest';
import {
  executeUploadWoundCareConsent,
  executeUploadWoundCarePhoto,
  executeGetWoundCareConsent,
  executeRevokeWoundCareConsent,
  executeListWoundCarePhotos,
  executeDeleteWoundCarePhoto,
} from '@/application/wound-care/woundCareUseCases';
import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
  WoundCareStoragePort,
} from '@/application/ports/woundCarePort';
import type {
  WoundCareAuditActor,
  WoundCareConsent,
  WoundCarePhoto,
} from '@/types/domain/woundCare';

// ============================================================================
// Mocks & Fixtures
// ============================================================================

const mockActor: WoundCareAuditActor = {
  uid: 'user-1',
  email: 'nurse@hospital.cl',
  displayName: 'Enfermera Test',
  role: 'editor',
};

const mockConsent: WoundCareConsent = {
  id: 'consent-1',
  patientRut: '12345678-9',
  patientName: 'Paciente Test',
  episodeKey: '12345678-9__2026-01-15',
  status: 'signed',
  consentFileStoragePath: 'wound-care/consents/test-path',
  consentFileDownloadUrl: 'https://storage.test/consent.pdf',
  consentFileMimeType: 'application/pdf',
  consentFileSize: 1024,
  signedAt: '2026-01-15T10:00:00Z',
  uploadedAt: '2026-01-15T10:00:00Z',
  uploadedBy: mockActor,
};

const mockEpisodeContext = {
  episodeKey: '12345678-9__2026-01-15',
  patientRut: '12345678-9',
  patientName: 'Paciente Test',
};

const createMockConsentPort = (
  overrides?: Partial<WoundCareConsentPort>
): WoundCareConsentPort => ({
  getByEpisode: vi.fn().mockResolvedValue(null),
  getAnyByEpisode: vi.fn().mockResolvedValue(null),
  listByPatientRut: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockImplementation(async c => c),
  revoke: vi.fn().mockResolvedValue(undefined),
  subscribeByEpisode: vi.fn().mockReturnValue(() => {}),
  ...overrides,
});

const createMockPhotoPort = (overrides?: Partial<WoundCarePhotoPort>): WoundCarePhotoPort => ({
  listByEpisode: vi.fn().mockResolvedValue([]),
  listByPatientRut: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockImplementation(async p => p),
  updateDescription: vi.fn().mockResolvedValue(undefined),
  softDelete: vi.fn().mockResolvedValue(undefined),
  subscribeByEpisode: vi.fn().mockReturnValue(() => {}),
  ...overrides,
});

const createMockStoragePort = (
  overrides?: Partial<WoundCareStoragePort>
): WoundCareStoragePort => ({
  uploadPhoto: vi
    .fn()
    .mockResolvedValue({ status: 'success', data: 'https://storage.test/photo.webp' }),
  uploadConsent: vi
    .fn()
    .mockResolvedValue({ status: 'success', data: 'https://storage.test/consent.pdf' }),
  uploadThumbnail: vi
    .fn()
    .mockResolvedValue({ status: 'success', data: 'https://storage.test/thumb.webp' }),
  deleteFile: vi.fn().mockResolvedValue({ status: 'success', data: null }),
  ...overrides,
});

// Mock image compression
vi.mock('@/utils/imageCompression', () => ({
  compressImage: vi.fn().mockResolvedValue({
    blob: new Blob(['compressed'], { type: 'image/webp' }),
    width: 800,
    height: 600,
    originalSize: 5000000,
    compressedSize: 300000,
  }),
  generateThumbnail: vi.fn().mockResolvedValue({
    blob: new Blob(['thumb'], { type: 'image/webp' }),
    width: 200,
    height: 150,
    originalSize: 5000000,
    compressedSize: 10000,
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('executeUploadWoundCareConsent', () => {
  it('uploads consent successfully', async () => {
    const consentPort = createMockConsentPort();
    const storagePort = createMockStoragePort();
    const file = new File(['pdf-content'], 'consent.pdf', { type: 'application/pdf' });

    const result = await executeUploadWoundCareConsent(
      { file, episodeContext: mockEpisodeContext, actor: mockActor, hospitalId: 'hosp-1' },
      { consentPort, storagePort }
    );

    expect(result.status).toBe('success');
    expect(result.data).not.toBeNull();
    expect(result.data?.status).toBe('signed');
    expect(result.data?.episodeKey).toBe(mockEpisodeContext.episodeKey);
    expect(storagePort.uploadConsent).toHaveBeenCalledOnce();
    expect(consentPort.create).toHaveBeenCalledOnce();
  });

  it('returns failed when storage upload fails', async () => {
    const storagePort = createMockStoragePort({
      uploadConsent: vi
        .fn()
        .mockResolvedValue({ status: 'permission_denied', error: new Error('denied'), data: null }),
    });

    const result = await executeUploadWoundCareConsent(
      {
        file: new File([''], 'c.pdf', { type: 'application/pdf' }),
        episodeContext: mockEpisodeContext,
        actor: mockActor,
        hospitalId: 'hosp-1',
      },
      { storagePort }
    );

    expect(result.status).toBe('failed');
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('executeGetWoundCareConsent', () => {
  it('returns consent when found', async () => {
    const consentPort = createMockConsentPort({
      getAnyByEpisode: vi.fn().mockResolvedValue(mockConsent),
    });

    const result = await executeGetWoundCareConsent(mockEpisodeContext.episodeKey, undefined, {
      consentPort,
    });

    expect(result.status).toBe('success');
    expect(result.data?.id).toBe('consent-1');
  });

  it('returns null when no consent exists', async () => {
    const consentPort = createMockConsentPort();

    const result = await executeGetWoundCareConsent(mockEpisodeContext.episodeKey, undefined, {
      consentPort,
    });

    expect(result.status).toBe('success');
    expect(result.data).toBeNull();
  });
});

describe('executeRevokeWoundCareConsent', () => {
  it('revokes consent successfully', async () => {
    const consentPort = createMockConsentPort();

    const result = await executeRevokeWoundCareConsent(
      'consent-1',
      'Patient requested',
      mockActor,
      undefined,
      { consentPort }
    );

    expect(result.status).toBe('success');
    expect(consentPort.revoke).toHaveBeenCalledOnce();
  });
});

describe('executeUploadWoundCarePhoto', () => {
  it('uploads photo successfully without consent (consent is optional)', async () => {
    const photoPort = createMockPhotoPort();
    const storagePort = createMockStoragePort();
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });

    const result = await executeUploadWoundCarePhoto(
      {
        file,
        episodeContext: mockEpisodeContext,
        description: 'Test curación',
        bodyLocation: 'Pierna derecha',
        actor: mockActor,
        hospitalId: 'hosp-1',
      },
      { photoPort, storagePort }
    );

    expect(result.status).toBe('success');
    expect(result.data).not.toBeNull();
    expect(result.data?.description).toBe('Test curación');
    expect(result.data?.bodyLocation).toBe('Pierna derecha');
    expect(result.data?.consentId).toBeUndefined();
    expect(storagePort.uploadPhoto).toHaveBeenCalledOnce();
    expect(storagePort.uploadThumbnail).toHaveBeenCalledOnce();
    expect(photoPort.create).toHaveBeenCalledOnce();
  });
});

describe('executeUploadWoundCarePhoto without a photo time', () => {
  it('records the hospital wall clock as takenAt and the real instant as uploadedAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 04:30 UTC on Nov 1 is still 23:30 on Oct 31 at the hospital.
    vi.setSystemTime(new Date('2026-11-01T04:30:00.000Z'));
    try {
      const result = await executeUploadWoundCarePhoto(
        {
          file: new File(['img'], 'photo.jpg', { type: 'image/jpeg' }),
          episodeContext: mockEpisodeContext,
          actor: mockActor,
          hospitalId: 'hosp-1',
        },
        { photoPort: createMockPhotoPort(), storagePort: createMockStoragePort() }
      );

      expect(result.data?.takenAt).toBe('2026-10-31T23:30:00.000Z');
      expect(result.data?.uploadedAt).toBe('2026-11-01T04:30:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('executeListWoundCarePhotos', () => {
  it('returns photos from port', async () => {
    const mockPhoto: WoundCarePhoto = {
      id: 'photo-1',
      patientRut: '12345678-9',
      patientName: 'Test',
      episodeKey: 'ep-1',
      consentId: 'c-1',
      storagePath: 'p',
      thumbnailStoragePath: 't',
      downloadUrl: 'https://test/p',
      thumbnailDownloadUrl: 'https://test/t',
      mimeType: 'image/webp',
      originalFileSize: 5000000,
      compressedFileSize: 300000,
      width: 800,
      height: 600,
      takenAt: '2026-01-15T10:00:00Z',
      uploadedAt: '2026-01-15T10:00:00Z',
      uploadedBy: mockActor,
      isDeleted: false,
    };
    const photoPort = createMockPhotoPort({
      listByEpisode: vi.fn().mockResolvedValue([mockPhoto]),
    });

    const result = await executeListWoundCarePhotos('ep-1', undefined, { photoPort });

    expect(result.status).toBe('success');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('photo-1');
  });
});

describe('executeDeleteWoundCarePhoto', () => {
  it('soft-deletes photo and cleans up storage', async () => {
    const photoPort = createMockPhotoPort();
    const storagePort = createMockStoragePort();

    const result = await executeDeleteWoundCarePhoto(
      'photo-1',
      'storage/path',
      'storage/thumb',
      mockActor,
      undefined,
      { photoPort, storagePort }
    );

    expect(result.status).toBe('success');
    expect(photoPort.softDelete).toHaveBeenCalledWith('photo-1', mockActor, undefined);
    expect(storagePort.deleteFile).toHaveBeenCalledTimes(2);
  });
});
