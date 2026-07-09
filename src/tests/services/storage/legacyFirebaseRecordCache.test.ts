import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocMock, docMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  docMock: vi.fn((_db: unknown, path: string) => ({ path })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: docMock,
  getDoc: getDocMock,
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('@/services/storage/legacyfirebase/legacyFirebaseCore', () => ({
  getLegacyDb: vi.fn(() => ({})),
}));

import {
  clearLegacyMissingDateCache,
  clearLegacyReadBlock,
  getLegacyRecord,
} from '@/services/storage/legacyfirebase/legacyFirebaseRecordService';

describe('legacyFirebaseRecordService missing-date cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLegacyReadBlock();
    clearLegacyMissingDateCache();
    getDocMock.mockResolvedValue({ exists: () => false });
  });

  it('avoids re-querying legacy paths for the same missing date in a session', async () => {
    await getLegacyRecord('2026-02-20');
    await getLegacyRecord('2026-02-20');

    // First call explores the known fallback paths (LEGACY_RECORD_DOC_PATHS, 4 entries
    // after the isolation commit dropped the hospital-hanga-roa path); the second call is
    // served entirely by the missing-date cache and issues no further getDoc probes.
    expect(getDocMock).toHaveBeenCalledTimes(4);
  });

  it('blocks subsequent legacy reads after permission denied on first probe', async () => {
    getDocMock.mockRejectedValueOnce({
      message: 'FirebaseError: Missing or insufficient permissions.',
    });

    await getLegacyRecord('2026-02-20');
    await getLegacyRecord('2026-02-19');

    // First call fails on first path and enables session block. Second call must skip probes.
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledTimes(1);
  });
});
