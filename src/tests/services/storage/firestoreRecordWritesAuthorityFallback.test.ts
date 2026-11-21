import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  firestoreWriteLoggerWarn,
  firestoreWriteLoggerError,
  mockAssertFirestoreConcurrency,
  mockFlattenObject,
  mockGetDoc,
  mockUpdateRecordPartiallyAtomically,
} = vi.hoisted(() => ({
  firestoreWriteLoggerWarn: vi.fn(),
  firestoreWriteLoggerError: vi.fn(),
  mockAssertFirestoreConcurrency: vi.fn(),
  mockFlattenObject: vi.fn((value: Record<string, unknown>) => value),
  mockGetDoc: vi.fn(),
  mockUpdateRecordPartiallyAtomically: vi.fn(),
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
  flattenObject: mockFlattenObject,
  getRecordDocRef: vi.fn((date: string) => ({ date })),
  sanitizeForFirestore: vi.fn((value: unknown) => value),
}));

vi.mock('@/services/storage/firestore/firestoreWriteSupport', () => ({
  ConcurrencyError: class ConcurrencyError extends Error {},
  asFirestoreUpdatePayload: vi.fn((payload: Record<string, unknown>) => payload),
  assertFirestoreConcurrency: mockAssertFirestoreConcurrency,
  createDeletedRecordRef: vi.fn((date: string) => ({ trashRef: date })),
  saveHistorySnapshot: vi.fn(),
  updateRecordPartiallyAtomically: mockUpdateRecordPartiallyAtomically,
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

import { updateDoc } from 'firebase/firestore';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { saveHistorySnapshot } from '@/services/storage/firestore/firestoreWriteSupport';

describe('firestoreRecordWrites authority fallback routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockReturnValue(null);
    mockResolveFirebaseUserRole.mockResolvedValue(null);
    mockEnsureUserRoleClaim.mockResolvedValue(undefined);
    mockHttpsCallable.mockReturnValue(mockAuthorityCallable);
    mockAuthorityCallable.mockResolvedValue({ data: { success: true } });
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
  });

  it('routes structural bed writes through the server', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.patientName': 'Edición estructural directa' } as never,
      '2026-03-14T10:00:00.000Z'
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'enforced',
        patch: { 'beds.R1.patientName': 'Edición estructural directa' },
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(mockUpdateRecordPartiallyAtomically).not.toHaveBeenCalled();
  });

  it('fails closed for mixed structural and document updates', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await expect(
      updateRecordPartial(
        '2026-03-14',
        {
          'beds.R1.patientName': 'Edición estructural directa',
          handoffNovedadesDayShift: 'Cambio de turno directo',
        } as never,
        '2026-03-14T10:00:00.000Z'
      )
    ).rejects.toThrow('debe guardarse por separado');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(mockUpdateRecordPartiallyAtomically).not.toHaveBeenCalled();
  });

  it('keeps day fields outside the bed tree on the direct Firestore transaction', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { handoffNovedadesDayShift: 'Novedad administrativa' } as never,
      '2026-03-14T10:00:00.000Z'
    );

    expect(mockHttpsCallable).not.toHaveBeenCalledWith(
      expect.anything(),
      'patchDailyRecordWithClinicalAuthority'
    );
    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).toHaveBeenCalledWith('2026-03-14', { force: false });
    // The copy stays outside: roles that cannot write history must still save the day.
    expect(mockUpdateRecordPartiallyAtomically).toHaveBeenCalledExactlyOnceWith(
      { date: '2026-03-14' },
      expect.objectContaining({ handoffNovedadesDayShift: 'Novedad administrativa' }),
      '2026-03-14T10:00:00.000Z',
      expect.any(String),
      'partial update',
      expect.objectContaining({ historyPolicy: 'skip' })
    );
  });

  it('forces the copy an automated run explicitly asks for before its first write', async () => {
    await updateRecordPartial(
      '2026-03-14',
      { handoffNovedadesDayShift: 'Novedad automatizada' } as never,
      '2026-03-14T10:00:00.000Z',
      { historyPolicy: 'snapshot' }
    );

    expect(saveHistorySnapshot).toHaveBeenCalledExactlyOnceWith('2026-03-14', { force: true });
    expect(mockUpdateRecordPartiallyAtomically).toHaveBeenCalledTimes(1);
  });

  it('can skip a repeated history snapshot for a serialized automated patch', async () => {
    await updateRecordPartial(
      '2026-03-14',
      { handoffNovedadesDayShift: 'Novedad automatizada' } as never,
      '2026-03-14T10:00:00.000Z',
      { historyPolicy: 'skip' }
    );

    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(mockUpdateRecordPartiallyAtomically).toHaveBeenCalledTimes(1);
  });
});
