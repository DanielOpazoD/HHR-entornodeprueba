import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  firestoreWriteLoggerWarn,
  firestoreWriteLoggerError,
  mockAssertFirestoreConcurrency,
  mockGetDoc,
} = vi.hoisted(() => ({
  firestoreWriteLoggerWarn: vi.fn(),
  firestoreWriteLoggerError: vi.fn(),
  mockAssertFirestoreConcurrency: vi.fn(),
  mockGetDoc: vi.fn(),
}));

const { mockEnsureUserRoleClaim, mockResolveFirebaseUserRole, mockGetCurrentUser, mockAuthReady } =
  vi.hoisted(() => ({
    mockEnsureUserRoleClaim: vi.fn(),
    mockResolveFirebaseUserRole: vi.fn(),
    mockGetCurrentUser: vi.fn(),
    mockAuthReady: Promise.resolve(),
  }));

const { mockHttpsCallable, mockAuthorityCallable, mockGetFunctions } = vi.hoisted(() => ({
  mockHttpsCallable: vi.fn(),
  mockAuthorityCallable: vi.fn(),
  mockGetFunctions: vi.fn().mockResolvedValue({ name: 'functions-runtime' }),
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    static now = vi.fn(() => new MockTimestamp());
  }

  return {
    ...actual,
    collection: vi.fn(),
    deleteDoc: vi.fn(),
    doc: vi.fn(),
    getDoc: mockGetDoc,
    setDoc: vi.fn(),
    Timestamp: MockTimestamp,
    updateDoc: vi.fn(),
  };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

vi.mock('@/utils/networkUtils', () => ({
  withRetry: vi.fn((operation: () => Promise<unknown> | unknown) => operation()),
}));

vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  flattenObject: vi.fn((value: Record<string, unknown>) => value),
  getRecordDocRef: vi.fn((date: string) => ({ date })),
  sanitizeForFirestore: vi.fn((value: unknown) => value),
}));

vi.mock('@/services/storage/firestore/firestoreWriteSupport', () => ({
  ConcurrencyError: class ConcurrencyError extends Error {},
  asFirestoreUpdatePayload: vi.fn((payload: Record<string, unknown>) => payload),
  assertFirestoreConcurrency: mockAssertFirestoreConcurrency,
  createDeletedRecordRef: vi.fn((date: string) => ({ trashRef: date })),
  saveHistorySnapshot: vi.fn(),
}));

vi.mock('@/services/storage/storageLoggers', () => ({
  firestoreWriteLogger: {
    warn: firestoreWriteLoggerWarn,
    error: firestoreWriteLoggerError,
  },
}));

vi.mock('@/services/auth/authClaimSyncService', () => ({
  ensureUserRoleClaim: (...args: unknown[]) => mockEnsureUserRoleClaim(...args),
}));

vi.mock('@/services/auth/authAccessResolution', () => ({
  resolveFirebaseUserRole: (...args: unknown[]) => mockResolveFirebaseUserRole(...args),
}));

vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: mockAuthReady,
    getCurrentUser: () => mockGetCurrentUser(),
  },
}));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: () => mockGetFunctions(),
    getRegionalFunctions: () => mockGetFunctions(),
  },
}));

import { setDoc, updateDoc } from 'firebase/firestore';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { saveHistorySnapshot } from '@/services/storage/firestore/firestoreWriteSupport';

describe('protected specialty rejection routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (import.meta.env as Record<string, string | undefined>)
      .VITE_DAILY_RECORD_AUTHORITY_CALLABLE;
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    mockGetCurrentUser.mockReturnValue(null);
    mockResolveFirebaseUserRole.mockResolvedValue(null);
    mockEnsureUserRoleClaim.mockResolvedValue(undefined);
    mockHttpsCallable.mockReturnValue(mockAuthorityCallable);
    mockAuthorityCallable.mockResolvedValue({ data: { success: true } });
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ schemaVersion: 2, clinicalBatchMode: 'enforced' }),
    });
  });

  it.each(['functions/permission-denied', 'permission-denied', 'functions/not-found', 'not-found'])(
    'preserves the guarded rejection for %s without retrying a legacy patch',
    async code => {
      const error = Object.assign(new Error('Rejected guarded specialty'), { code });
      mockAuthorityCallable.mockRejectedValue(error);
      const specialtyIntent = {
        kind: 'manual' as const,
        bedId: 'R1',
        target: 'bed' as const,
        episodeId: 'synthetic-episode-r1',
        value: 'Cirugía',
        expectedDecisionId: null,
      };

      await expect(
        updateRecordPartial(
          '2026-03-14',
          { 'beds.R1.specialty': 'Cirugía' },
          '2026-03-14T10:00:00.000Z',
          { specialtyIntent }
        )
      ).rejects.toBe(error);

      expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
      expect(mockAuthorityCallable).toHaveBeenCalledWith(
        expect.objectContaining({ specialtyIntent, mode: 'enforced' })
      );
      expect(mockEnsureUserRoleClaim).not.toHaveBeenCalled();
      expect(updateDoc).not.toHaveBeenCalled();
      expect(setDoc).not.toHaveBeenCalled();
      expect(saveHistorySnapshot).not.toHaveBeenCalled();
    }
  );
});
