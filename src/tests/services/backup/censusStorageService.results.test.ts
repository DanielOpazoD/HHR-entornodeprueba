// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObject, getDownloadURL, uploadBytes } from 'firebase/storage';
import {
  deleteCensusFileWithResult,
  uploadCensusWithResult,
} from '@/services/backup/censusStorageService';

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
  getMetadata: vi.fn(),
}));

vi.mock('@/firebaseConfig', () => ({
  storage: {} as Record<string, never>,
  getStorageInstance: vi.fn().mockResolvedValue({} as Record<string, never>),
  auth: { currentUser: null },
  firebaseReady: Promise.resolve(),
}));

describe('censusStorageService mutation results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success on upload', async () => {
    vi.mocked(uploadBytes).mockResolvedValue(undefined as never);
    vi.mocked(getDownloadURL).mockResolvedValue('https://example.com/file.xlsx');

    const result = await uploadCensusWithResult(new Blob(['ok']), '2026-03-15');
    expect(result.status).toBe('success');
  });

  it('returns permission_denied on restricted delete', async () => {
    vi.mocked(deleteObject).mockRejectedValue({ code: 'storage/unauthorized' });

    const result = await deleteCensusFileWithResult('2026-03-15');
    expect(result.status).toBe('permission_denied');
  });

  it('returns invalid_date on malformed delete input', async () => {
    const result = await deleteCensusFileWithResult('15-03-2026');
    expect(result.status).toBe('invalid_date');
  });
});
