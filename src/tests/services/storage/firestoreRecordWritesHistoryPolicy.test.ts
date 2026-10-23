import { beforeEach, describe, expect, it, vi } from 'vitest';
const { firestoreWriteLoggerWarn, firestoreWriteLoggerError } = vi.hoisted(() => ({
  firestoreWriteLoggerWarn: vi.fn(),
  firestoreWriteLoggerError: vi.fn(),
}));
const { mockEnsureUserRoleClaim, mockResolveFirebaseUserRole, mockGetCurrentUser, mockAuthReady } =
  vi.hoisted(() => ({
    mockEnsureUserRoleClaim: vi.fn(),
    mockResolveFirebaseUserRole: vi.fn(),
    mockGetCurrentUser: vi.fn(),
    mockAuthReady: Promise.resolve(),
  }));
const { mockHttpsCallable, mockSpecialistCallable, mockGetFunctions } = vi.hoisted(() => ({
  mockHttpsCallable: vi.fn(),
  mockSpecialistCallable: vi.fn(),
  mockGetFunctions: vi.fn().mockResolvedValue({ name: 'functions-runtime' }),
}));
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    static now = vi.fn(() => new MockTimestamp());

    toDate = () => new Date('2026-03-14T12:34:56.789Z');
  }

  return {
    ...actual,
    collection: vi.fn(),
    deleteDoc: vi.fn(),
    doc: vi.fn(),
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
  assertFirestoreConcurrency: vi.fn(),
  createDeletedRecordRef: vi.fn((date: string) => ({ trashRef: date })),
  saveHistorySnapshot: vi.fn(),
  saveRecordAtomically: vi.fn(),
  updateRecordPartiallyAtomically: vi.fn(),
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
import { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { saveRecordAtomically } from '@/services/storage/firestore/firestoreWriteSupport';

// Full saves copy the live day to history at most hourly; restores always copy first.
describe('firestoreRecordWrites history policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (import.meta.env as Record<string, string | undefined>)
      .VITE_DAILY_RECORD_AUTHORITY_CALLABLE;
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    mockGetCurrentUser.mockReturnValue(null);
    mockResolveFirebaseUserRole.mockResolvedValue(null);
    mockEnsureUserRoleClaim.mockResolvedValue(undefined);
    mockHttpsCallable.mockReturnValue(mockSpecialistCallable);
    mockSpecialistCallable.mockResolvedValue({ data: { success: true } });
  });

  it.each([
    [{ historyPolicy: 'snapshot' as const }, true],
    [{ origin: 'backup_restore' as const }, true],
    [{ origin: 'direct_save' as const }, false],
  ])('forces the pre-write history copy only for restores: %j', async (options, forced) => {
    await saveRecordToFirestore({ date: '2026-03-17', beds: {} } as never, undefined, options);

    expect(saveRecordAtomically).toHaveBeenCalledWith(
      { date: '2026-03-17' },
      expect.objectContaining({ date: '2026-03-17' }),
      undefined,
      expect.any(String),
      'save',
      expect.objectContaining({ forceHistorySnapshot: forced })
    );
  });
});
