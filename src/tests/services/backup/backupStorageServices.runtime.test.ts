// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  ref: vi.fn((_storage: unknown, path: string) => ({
    fullPath: path,
    name: path.split('/').pop(),
  })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
  getMetadata: vi.fn(),
  listAll: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: storageMocks.ref,
  uploadBytes: storageMocks.uploadBytes,
  getDownloadURL: storageMocks.getDownloadURL,
  deleteObject: storageMocks.deleteObject,
  getMetadata: storageMocks.getMetadata,
  listAll: storageMocks.listAll,
}));

import { createPdfStorageService } from '@/services/backup/pdfStorageService';
import { createCensusStorageService } from '@/services/backup/censusStorageService';
import { createCudyrStorageService } from '@/services/backup/cudyrStorageService';

describe('backup storage services runtime injection', () => {
  const runtime = {
    auth: { currentUser: { email: 'test@hospital.cl' } },
    ready: Promise.resolve(),
    getStorage: vi.fn().mockResolvedValue({ custom: true } as never),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runtime.getStorage.mockResolvedValue({ custom: true } as never);
    storageMocks.uploadBytes.mockResolvedValue(undefined);
    storageMocks.getDownloadURL.mockResolvedValue('https://example.com/file');
    storageMocks.getMetadata.mockResolvedValue({});
    storageMocks.listAll.mockResolvedValue({ items: [] });
  });

  it('uploads PDFs through the injected backup runtime', async () => {
    const service = createPdfStorageService(runtime as never);
    await expect(service.uploadPdf(new Blob(['pdf']), '2026-04-04', 'day')).resolves.toBe(
      'https://example.com/file'
    );
  });

  it('returns structured mutation results for census uploads through the injected runtime', async () => {
    const service = createCensusStorageService(runtime as never);
    await expect(service.uploadCensusWithResult(new Blob(['xlsx']), '2026-04-04')).resolves.toEqual(
      { status: 'success', data: 'https://example.com/file' }
    );
  });

  it('uploads CUDYR files through the injected runtime and tolerates missing legacy files', async () => {
    storageMocks.getMetadata.mockRejectedValueOnce({ code: 'storage/object-not-found' });
    const service = createCudyrStorageService(runtime as never);
    await expect(service.uploadCudyrExcel(new Blob(['xlsx']), '2026-04-04')).resolves.toBe(
      'https://example.com/file'
    );
  });
});
