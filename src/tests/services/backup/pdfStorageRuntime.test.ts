import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetadata, getDownloadURL, deleteObject, uploadBytes } from 'firebase/storage';
import {
  deletePdf,
  deletePdfWithResult,
  getPdfUrl,
  pdfExists,
  pdfExistsDetailed,
  uploadPdfWithResult,
} from '@/services/backup/pdfStorageService';

vi.mock('@/firebaseConfig', () => ({
  storage: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  auth: { currentUser: { email: 'test@example.com' } },
  firebaseReady: Promise.resolve(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  listAll: vi.fn(),
  deleteObject: vi.fn(),
  getMetadata: vi.fn(),
}));

describe('pdfStorageService runtime resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null url on expected lookup miss errors', async () => {
    vi.mocked(getDownloadURL).mockRejectedValue({ code: 'storage/unauthorized' });
    await expect(getPdfUrl('2026-02-19', 'day')).resolves.toBeNull();
  });

  it('returns null url when storage returns 404 inside unknown error message', async () => {
    vi.mocked(getDownloadURL).mockRejectedValue({
      code: 'storage/unknown',
      message: 'Firebase Storage: HTTP 404 Not Found',
    });
    await expect(getPdfUrl('2026-02-19', 'day')).resolves.toBeNull();
  });

  it('returns null/false for invalid date formats without throwing', async () => {
    await expect(getPdfUrl('19-02-2026', 'day')).resolves.toBeNull();
    await expect(pdfExists('19-02-2026', 'night')).resolves.toBe(false);
  });

  it('returns false for unauthorized/unauthenticated in exists check', async () => {
    vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/unauthorized' });
    await expect(pdfExists('2026-02-19', 'day')).resolves.toBe(false);

    vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/unauthenticated' });
    await expect(pdfExists('2026-02-19', 'night')).resolves.toBe(false);
  });

  it('returns detailed restricted status for unauthorized checks', async () => {
    vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/unauthorized' });
    await expect(pdfExistsDetailed('2026-02-19', 'day')).resolves.toEqual({
      exists: false,
      status: 'restricted',
    });
  });

  it('delete swallows expected miss errors and rethrows unexpected ones', async () => {
    vi.mocked(deleteObject).mockRejectedValueOnce({ code: 'storage/object-not-found' });
    await expect(deletePdf('2026-02-19', 'day')).resolves.toBeUndefined();

    vi.mocked(deleteObject).mockRejectedValueOnce(new Error('delete failed'));
    await expect(deletePdf('2026-02-19', 'night')).rejects.toThrow('delete failed');
  });

  it('delete ignores invalid date inputs', async () => {
    await expect(deletePdf('19-02-2026', 'day')).resolves.toBeUndefined();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('returns structured upload failures instead of throwing', async () => {
    vi.mocked(uploadBytes).mockRejectedValue({ code: 'storage/unauthorized' });

    const result = await uploadPdfWithResult(new Blob(['pdf']), '2026-02-19', 'day');

    expect(result.status).toBe('permission_denied');
  });

  it('returns structured invalid-date delete failures', async () => {
    const result = await deletePdfWithResult('19-02-2026', 'day');

    expect(result.status).toBe('invalid_date');
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
