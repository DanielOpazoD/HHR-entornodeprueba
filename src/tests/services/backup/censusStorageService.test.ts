// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObject } from 'firebase/storage';

const { refMock, getMetadataMock, listAllMock } = vi.hoisted(() => ({
  refMock: vi.fn((_storage: unknown, path: string) => ({
    fullPath: path,
    name: path.split('/').pop(),
  })),
  getMetadataMock: vi.fn(),
  listAllMock: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
  getMetadata: getMetadataMock,
  listAll: listAllMock,
}));

vi.mock('@/firebaseConfig', () => ({
  storage: {} as Record<string, never>,
  getStorageInstance: vi.fn().mockResolvedValue({} as Record<string, never>),
  auth: { currentUser: null },
  firebaseReady: Promise.resolve(),
}));

import {
  checkCensusExists,
  checkCensusExistsDetailed,
  deleteCensusFile,
} from '@/services/backup/censusStorageService';

describe('censusStorageService', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterAll(() => {
    warnSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when metadata exists for expected census path', async () => {
    listAllMock.mockResolvedValue({
      items: [{ name: '19-02-2026 - Censo Diario.xlsx' }],
    });

    const exists = await checkCensusExists('2026-02-19');

    expect(exists).toBe(true);
    expect(refMock).toHaveBeenCalledWith({}, 'censo-diario/2026/02');
  });

  it('returns false on expected lookup miss', async () => {
    listAllMock.mockResolvedValue({
      items: [{ name: '18-02-2026 - Censo Diario.xlsx' }],
    });

    const exists = await checkCensusExists('2026-02-19');

    expect(exists).toBe(false);
  });

  it('returns detailed restricted status on unauthorized lookup', async () => {
    listAllMock.mockRejectedValue({ code: 'storage/unauthorized' });

    const exists = await checkCensusExistsDetailed('2026-02-19');

    expect(exists).toEqual({ exists: false, status: 'restricted' });
  });

  it('returns false for invalid input date without crashing', async () => {
    const exists = await checkCensusExists('19-02-2026');
    expect(exists).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores delete requests with invalid date format', async () => {
    await expect(deleteCensusFile('19-02-2026')).resolves.toBeUndefined();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
