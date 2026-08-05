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
  },
}));

import { updateDoc } from 'firebase/firestore';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { saveHistorySnapshot } from '@/services/storage/firestore/firestoreWriteSupport';

describe('firestoreRecordWrites authority fallback routing', () => {
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

  it('routes structural writes through the server after policy schema v2 activates the fence', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ schemaVersion: 2, clinicalBatchMode: 'off' }),
    });
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
  });

  it('fails closed for mixed structural and document updates after the schema-v2 fence', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ schemaVersion: 2, clinicalBatchMode: 'off' }),
    });
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
  });

  it('keeps non-clinical partial updates on direct Firestore writes in enforced mode', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
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
    expect(saveHistorySnapshot).toHaveBeenCalledWith('2026-03-14');
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('can skip a repeated history snapshot for a serialized automated clinical patch', async () => {
    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.vitalSigns': { heartRate: 80 } } as never,
      '2026-03-14T10:00:00.000Z',
      { historyPolicy: 'skip' }
    );

    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('routes a frozen Rayen legacy write through the server-atomic policy guard', async () => {
    const rayenClinicalWriteGuard = {
      runId: 'run-1',
      importMode: 'preview' as const,
      clinicalBatchMode: 'shadow' as const,
      revision: 4,
      sourceDate: '2026-03-14',
      recordScope: 'run' as const,
    };

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.vitalSigns': { heartRate: 80 } } as never,
      '2026-03-14T10:00:00.000Z',
      { rayenClinicalWriteGuard, historyPolicy: 'skip' }
    );

    expect(mockAssertFirestoreConcurrency).not.toHaveBeenCalled();
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLastUpdated: '2026-03-14T10:00:00.000Z',
        rayenClinicalWriteGuard,
        historyPolicy: 'skip',
        patch: { 'beds.R1.vitalSigns': { heartRate: 80 } },
      })
    );
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
