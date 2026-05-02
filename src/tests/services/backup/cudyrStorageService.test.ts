import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadCudyrExcel,
  uploadCudyrExcelWithResult,
  cudyrExists,
  cudyrExistsDetailed,
  deleteCudyrFile,
  deleteCudyrFileWithResult,
  listCudyrYears,
  listCudyrMonths,
  listCudyrFilesInMonth,
} from '@/services/backup/cudyrStorageService';
import { uploadBytes, getDownloadURL, getMetadata, deleteObject } from 'firebase/storage';

// Mock firebaseConfig to resolve firebaseReady
vi.mock('@/firebaseConfig', () => ({
  storage: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  auth: { currentUser: { email: 'test@example.com' } },
  firebaseReady: Promise.resolve(),
}));

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  listAll: vi.fn(),
  deleteObject: vi.fn(),
  getMetadata: vi.fn(),
}));

// Mock baseStorageService helpers
vi.mock('@/services/backup/baseStorageService', () => ({
  MONTH_NAMES: [],
  createListYears: vi.fn(() => vi.fn()),
  createListMonths: vi.fn(() => vi.fn()),
  createListFilesInMonth: vi.fn(() => vi.fn()),
  createListFilesInMonthWithReport: vi.fn(() => vi.fn()),
}));

describe('cudyrStorageService', () => {
  const mockDate = '2025-01-01';
  const mockBlob = new Blob(['content']);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadCudyrExcel', () => {
    it('should upload CUDYR and attempt to delete legacy files', async () => {
      vi.mocked(uploadBytes).mockResolvedValue({} as Awaited<ReturnType<typeof uploadBytes>>);
      vi.mocked(getDownloadURL).mockResolvedValue('http://download.url');
      vi.mocked(getMetadata).mockResolvedValue({} as Awaited<ReturnType<typeof getMetadata>>);

      const url = await uploadCudyrExcel(mockBlob, mockDate);

      expect(url).toBe('http://download.url');
      expect(uploadBytes).toHaveBeenCalled();
    });

    it('returns structured upload failures for restricted storage', async () => {
      vi.mocked(uploadBytes).mockRejectedValue({ code: 'storage/unauthorized' });

      const result = await uploadCudyrExcelWithResult(mockBlob, mockDate);

      expect(result.status).toBe('permission_denied');
    });
  });

  describe('cudyrExists', () => {
    it('should return true if metadata is found', async () => {
      vi.mocked(getMetadata).mockResolvedValue({} as Awaited<ReturnType<typeof getMetadata>>);

      const exists = await cudyrExists(mockDate);
      expect(exists).toBe(true);
    });

    it('should return false if object not found', async () => {
      vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/object-not-found' });

      const exists = await cudyrExists(mockDate);
      expect(exists).toBe(false);
    });

    it('should return false for unauthorized/unauthenticated lookups', async () => {
      vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/unauthorized' });
      expect(await cudyrExists(mockDate)).toBe(false);

      vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/unauthenticated' });
      expect(await cudyrExists(mockDate)).toBe(false);
    });

    it('returns detailed restricted status for unauthorized lookups', async () => {
      vi.mocked(getMetadata).mockRejectedValue({ code: 'storage/unauthorized' });
      await expect(cudyrExistsDetailed(mockDate)).resolves.toEqual({
        exists: false,
        status: 'restricted',
      });
    });

    it('should return false when storage reports 403/404 through unknown error payload', async () => {
      vi.mocked(getMetadata).mockRejectedValue({
        code: 'storage/unknown',
        customData: { serverResponse: 'status=403 Forbidden' },
      });
      expect(await cudyrExists(mockDate)).toBe(false);
    });

    it('returns false for invalid date format without throwing', async () => {
      await expect(cudyrExists('01-01-2025')).resolves.toBe(false);
    });
  });

  describe('deleteCudyrFile', () => {
    it('swallows expected storage misses', async () => {
      vi.mocked(deleteObject).mockRejectedValue({ code: 'storage/object-not-found' });
      await expect(deleteCudyrFile(mockDate)).resolves.toBeUndefined();
    });

    it('rethrows unexpected errors', async () => {
      vi.mocked(deleteObject).mockRejectedValue(new Error('delete failed'));
      await expect(deleteCudyrFile(mockDate)).rejects.toThrow('delete failed');
    });

    it('ignores invalid dates during delete', async () => {
      await expect(deleteCudyrFile('01-01-2025')).resolves.toBeUndefined();
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('returns structured invalid-date delete failures', async () => {
      const result = await deleteCudyrFileWithResult('01-01-2025');

      expect(result.status).toBe('invalid_date');
      expect(deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('Factory-provided functions', () => {
    it('should exist', () => {
      expect(listCudyrYears).toBeDefined();
      expect(listCudyrMonths).toBeDefined();
      expect(listCudyrFilesInMonth).toBeDefined();
    });
  });
});
