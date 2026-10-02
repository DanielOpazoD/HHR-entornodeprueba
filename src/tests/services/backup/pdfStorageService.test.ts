// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  type FirebaseStorage,
  type FullMetadata,
  type StorageReference,
} from 'firebase/storage';
import {
  createPdfStorageService,
  listFilesInMonth,
  listFilesInMonthWithReport,
} from '@/services/backup/pdfStorageService';
import type { BackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  listAll: vi.fn(),
  deleteObject: vi.fn(),
  getMetadata: vi.fn(),
}));

const storage = {} as FirebaseStorage;
const runtime: BackupStorageRuntime = {
  ready: Promise.resolve(),
  getStorage: vi.fn(async () => storage),
  auth: { currentUser: null } as BackupStorageRuntime['auth'],
};
const downloadUrl = 'https://storage.example.invalid/synthetic.pdf';
const uploadedAt = '2026-01-03T10:00:00Z';
const metadata: FullMetadata = {
  bucket: 'synthetic-bucket',
  fullPath: 'synthetic.pdf',
  generation: '1',
  metageneration: '1',
  name: 'synthetic.pdf',
  size: 150000,
  timeCreated: '2026-01-03T09:00:00Z',
  updated: uploadedAt,
  downloadTokens: undefined,
};
const storedReference = (name: string) =>
  ({
    name,
    fullPath: `entregas-enfermeria/2026/01/${name}`,
  }) as StorageReference;

describe('pdfStorageService file contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(ref).mockImplementation((_storage, fullPath) => ({ fullPath }) as StorageReference);
    vi.mocked(getDownloadURL).mockResolvedValue(downloadUrl);
    vi.mocked(getMetadata).mockImplementation(async item => ({
      ...metadata,
      name: item.name,
      fullPath: item.fullPath,
      customMetadata: { uploadedAt },
    }));
    vi.mocked(listAll).mockResolvedValue({ items: [], prefixes: [] });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([
    ['day', 'Largo'],
    ['night', 'Noche'],
  ] as const)('uses the real path generator for the %s shift', async (shift, label) => {
    const service = createPdfStorageService(runtime);

    await expect(service.getPdfUrl('2026-01-03', shift)).resolves.toBe(downloadUrl);

    const fullPath = `entregas-enfermeria/2026/01/03-01-2026 - Turno ${label}.pdf`;
    expect(ref).toHaveBeenCalledExactlyOnceWith(storage, fullPath);
    expect(getDownloadURL).toHaveBeenCalledExactlyOnceWith({ fullPath });
  });

  it.each([
    ['03-01-2026 - Turno Largo.pdf', 'day'],
    ['03-01-2026 - Turno Noche.pdf', 'night'],
    ['2026-01-03_turno-largo.pdf', 'day'],
    ['2026-01-03_turno-noche.pdf', 'night'],
  ] as const)('parses %s through the public listing API', async (name, shiftType) => {
    const item = storedReference(name);
    vi.mocked(listAll).mockResolvedValue({ items: [item], prefixes: [] });

    await expect(listFilesInMonth('2026', '01', runtime)).resolves.toEqual([
      {
        name,
        fullPath: item.fullPath,
        downloadUrl,
        date: '2026-01-03',
        shiftType,
        createdAt: uploadedAt,
        size: 150000,
      },
    ]);
    expect(ref).toHaveBeenCalledExactlyOnceWith(storage, 'entregas-enfermeria/2026/01');
    expect(listAll).toHaveBeenCalledExactlyOnceWith({ fullPath: 'entregas-enfermeria/2026/01' });
    expect(getMetadata).toHaveBeenCalledExactlyOnceWith(item);
    expect(getDownloadURL).toHaveBeenCalledExactlyOnceWith(item);
  });

  it('keeps valid files, reports unparsed names and falls back to the storage timestamp', async () => {
    const valid = storedReference('03-01-2026 - Turno Largo.pdf');
    vi.mocked(listAll).mockResolvedValue({
      items: [storedReference('unrecognized.pdf'), valid],
      prefixes: [],
    });
    vi.mocked(getMetadata).mockImplementation(async item => ({
      ...metadata,
      name: item.name,
      fullPath: item.fullPath,
      size: 42,
      timeCreated: uploadedAt,
    }));

    const result = await listFilesInMonthWithReport('2026', '01', runtime);

    expect(result.files).toEqual([
      {
        name: valid.name,
        fullPath: valid.fullPath,
        downloadUrl,
        date: '2026-01-03',
        shiftType: 'day',
        createdAt: uploadedAt,
        size: 42,
      },
    ]);
    expect(result.report).toMatchObject({ skippedUnparsed: 1, timedOut: false });
  });
});
