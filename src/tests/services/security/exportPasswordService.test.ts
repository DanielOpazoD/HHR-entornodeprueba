// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getExportPasswordsPath } from '@/constants/firestorePaths';
import {
  createExportPasswordPersistenceService,
  type ExportPasswordRecord,
} from '@/services/security/exportPasswordService';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: firestoreMocks.collection,
  query: firestoreMocks.query,
  orderBy: firestoreMocks.orderBy,
  limit: firestoreMocks.limit,
  getDocs: firestoreMocks.getDocs,
  doc: firestoreMocks.doc,
  setDoc: firestoreMocks.setDoc,
}));

vi.mock('@/services/security/securityLoggers', () => ({
  exportPasswordLogger: loggerMocks,
}));

describe('exportPasswordService', () => {
  const runtime = {
    db: { name: 'db' } as never,
  };
  const exportPasswordsPath = getExportPasswordsPath();

  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMocks.collection.mockReturnValue('collection-ref');
    firestoreMocks.orderBy.mockReturnValue('order-by');
    firestoreMocks.limit.mockReturnValue('limit');
    firestoreMocks.query.mockReturnValue('query-ref');
    firestoreMocks.doc.mockReturnValue('doc-ref');
    firestoreMocks.setDoc.mockResolvedValue(undefined);
  });

  it('reads stored passwords through an injected firestore runtime', async () => {
    const records: ExportPasswordRecord[] = [
      {
        date: '2026-04-04',
        password: 'secret',
        createdAt: '2026-04-04T10:00:00.000Z',
        source: 'email',
      },
    ];

    firestoreMocks.getDocs.mockResolvedValue({
      forEach: (callback: (doc: { data: () => ExportPasswordRecord }) => void) => {
        records.forEach(record => callback({ data: () => record }));
      },
    });

    const service = createExportPasswordPersistenceService(runtime);

    await expect(service.getStoredPasswords(10)).resolves.toEqual(records);
    expect(firestoreMocks.collection).toHaveBeenCalledWith(runtime.db, exportPasswordsPath);
    expect(firestoreMocks.query).toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('saves passwords through an injected firestore runtime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T12:30:00.000Z'));

    const service = createExportPasswordPersistenceService(runtime);

    await service.savePasswordToFirestore(
      '2026-04-04',
      'secret',
      'user@hospital.cl',
      'manual_download'
    );

    expect(firestoreMocks.doc).toHaveBeenCalledWith(runtime.db, exportPasswordsPath, '2026-04-04');
    expect(firestoreMocks.setDoc).toHaveBeenCalledWith(
      'doc-ref',
      expect.objectContaining({
        date: '2026-04-04',
        password: 'secret',
        createdAt: '2026-04-04T12:30:00.000Z',
        createdBy: 'user@hospital.cl',
        source: 'manual_download',
      }),
      { merge: true }
    );

    vi.useRealTimers();
  });

  it('logs and returns an empty list when firestore read fails', async () => {
    firestoreMocks.getDocs.mockRejectedValue(new Error('read failed'));
    const service = createExportPasswordPersistenceService(runtime);

    await expect(service.getStoredPasswords()).resolves.toEqual([]);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Failed to get stored passwords',
      expect.any(Error)
    );
  });
});
