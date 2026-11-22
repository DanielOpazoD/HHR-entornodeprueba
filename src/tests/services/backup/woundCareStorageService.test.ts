import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('firebase/storage', () => ({
  ref: vi.fn().mockReturnValue({}),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.test/file.webp'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/backup/backupStorageRuntimeSupport', () => ({
  resolveBackupStorage: vi.fn().mockResolvedValue({}),
  createBackupMutationResultFromError: vi.fn().mockImplementation(error => ({
    status: 'unknown',
    error,
    data: null,
  })),
}));

vi.mock('@/services/backup/storageAvailability', () => ({
  assertStorageAvailable: vi.fn(),
}));

vi.mock('@/services/firebase-runtime/backupRuntime', () => ({
  defaultBackupStorageRuntime: {
    auth: { currentUser: { email: 'test@test.cl' } },
    ready: Promise.resolve(),
    getStorage: vi.fn().mockResolvedValue({}),
  },
}));

import { uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { createWoundCareStorageService } from '@/features/wound-care/services/woundCareStorageService';
import { logger } from '@/services/utils/loggerService';

// ============================================================================
// Tests
// ============================================================================

describe('woundCareStorageService', () => {
  const service = createWoundCareStorageService();

  beforeEach(() => {
    vi.clearAllMocks();
    logger.setLevel('debug');
    logger.clearEntries();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // --------------------------------------------------------------------------
  // uploadPhoto
  // --------------------------------------------------------------------------

  it('uploadPhoto returns success with download URL', async () => {
    const blob = new Blob(['test'], { type: 'image/webp' });
    const result = await service.uploadPhoto(blob, 'wound-care/photos/test.webp', {
      contentType: 'image/webp',
    });

    expect(result.status).toBe('success');
    expect(result.data).toBe('https://storage.test/file.webp');
    expect(uploadBytes).toHaveBeenCalledOnce();
    expect(getDownloadURL).toHaveBeenCalledOnce();
  });

  // --------------------------------------------------------------------------
  // uploadConsent
  // --------------------------------------------------------------------------

  it('uploadConsent returns success', async () => {
    const blob = new Blob(['pdf-data'], { type: 'application/pdf' });
    const result = await service.uploadConsent(blob, 'wound-care/consents/consent.pdf', {
      contentType: 'application/pdf',
    });

    expect(result.status).toBe('success');
    expect(result.data).toBe('https://storage.test/file.webp');
    expect(uploadBytes).toHaveBeenCalledOnce();
  });

  // --------------------------------------------------------------------------
  // uploadThumbnail
  // --------------------------------------------------------------------------

  it('uploadThumbnail returns success', async () => {
    const blob = new Blob(['thumb'], { type: 'image/webp' });
    const result = await service.uploadThumbnail(blob, 'wound-care/thumbnails/thumb.webp');

    expect(result.status).toBe('success');
    expect(result.data).toBe('https://storage.test/file.webp');
    expect(uploadBytes).toHaveBeenCalledOnce();
  });

  // --------------------------------------------------------------------------
  // deleteFile
  // --------------------------------------------------------------------------

  it('deleteFile returns success', async () => {
    const result = await service.deleteFile('wound-care/photos/old.webp');

    expect(result.status).toBe('success');
    expect(result.data).toBeNull();
    expect(deleteObject).toHaveBeenCalledOnce();
  });

  // --------------------------------------------------------------------------
  // Error paths
  // --------------------------------------------------------------------------

  it('uploadPhoto returns error when uploadBytes fails', async () => {
    const uploadError = new Error('upload-failed');
    vi.mocked(uploadBytes).mockRejectedValueOnce(uploadError);

    const blob = new Blob(['fail'], { type: 'image/webp' });
    const result = await service.uploadPhoto(blob, 'wound-care/photos/fail.webp', {
      contentType: 'image/webp',
    });

    expect(result.status).toBe('unknown');
    expect(result.data).toBeNull();
  });

  it('deleteFile returns error when deleteObject fails', async () => {
    const deleteError = new Error('delete-failed');
    vi.mocked(deleteObject).mockRejectedValueOnce(deleteError);

    const result = await service.deleteFile('wound-care/photos/missing.webp');

    expect(result.status).toBe('unknown');
    expect(result.data).toBeNull();
  });

  it('getDownloadUrl logs failures through the structured logger before rethrowing', async () => {
    const downloadError = new Error('download-failed');
    vi.mocked(getDownloadURL).mockRejectedValueOnce(downloadError);

    await expect(service.getDownloadUrl('wound-care/photos/fail.webp')).rejects.toThrow(
      'download-failed'
    );

    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({
        level: 'error',
        context: 'WoundCareStorage',
        message: 'Error getting download URL',
        data: downloadError,
      })
    );
  });
});
