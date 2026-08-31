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

import { updateDoc } from 'firebase/firestore';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { saveHistorySnapshot } from '@/services/storage/firestore/firestoreWriteSupport';

describe('firestoreRecordWrites intentional bed clear routing', () => {
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

  it('routes an intentional clear as one atomic whole-bed replacement', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });
    const emptyBed = {
      bedId: 'R1',
      patientName: '',
      rut: '',
      pathology: '',
      admissionDate: '',
      admissionTime: '',
      clinicalEpisodeId: '',
      isBlocked: false,
    };

    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1': emptyBed,
        dateTimestamp: 1773446400000,
      } as never,
      '2026-03-14T10:00:00.000Z',
      {
        intentionalBedClear: {
          bedId: 'R1',
          confirmedLastUpdated: '2026-03-14T10:00:00.000Z',
          confirmedOccupant: {
            clinicalEpisodeId: 'ep-r1',
            patientName: 'Paciente Uno',
          },
        },
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1'],
          mutationId: 'mutation-clear-r1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        expectedLastUpdated: '2026-03-14T10:00:00.000Z',
        intentionalBedClear: {
          bedId: 'R1',
          confirmedLastUpdated: '2026-03-14T10:00:00.000Z',
          confirmedOccupant: {
            clinicalEpisodeId: 'ep-r1',
            patientName: 'Paciente Uno',
          },
        },
        patch: { 'beds.R1': emptyBed },
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1'],
          mutationId: 'mutation-clear-r1',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(mockAssertFirestoreConcurrency).not.toHaveBeenCalled();
  });

  it('routes an intentional clinical crib clear without replacing the parent bed', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.clinicalCrib': null } as never,
      '2026-03-14T10:00:00.000Z',
      {
        intentionalBedClear: {
          bedId: 'R1',
          target: 'clinicalCrib',
          confirmedLastUpdated: '2026-03-14T10:00:00.000Z',
          confirmedOccupant: {
            clinicalEpisodeId: 'crib-ep-r1',
            patientName: 'RN Uno',
          },
        },
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.clinicalCrib'],
          mutationId: 'mutation-clear-r1-crib',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        intentionalBedClear: expect.objectContaining({
          bedId: 'R1',
          target: 'clinicalCrib',
        }),
        patch: { 'beds.R1.clinicalCrib': null },
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(mockAssertFirestoreConcurrency).not.toHaveBeenCalled();
  });

  it('rejects an intentional clear whose declared bed does not match the whole-bed patch', async () => {
    await expect(
      updateRecordPartial(
        '2026-03-14',
        {
          'beds.R2': {
            bedId: 'R2',
            patientName: '',
            rut: '',
          },
        } as never,
        '2026-03-14T10:00:00.000Z',
        {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-03-14T10:00:00.000Z',
            confirmedOccupant: { patientName: 'Paciente Uno', admissionDate: '2026-03-14' },
          },
        }
      )
    ).rejects.toThrow('únicamente una cama completa');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an intentional clear instead of silently dropping another requested mutation', async () => {
    await expect(
      updateRecordPartial(
        '2026-03-14',
        {
          'beds.R1': {
            bedId: 'R1',
            patientName: '',
            rut: '',
          },
          'beds.R2.status': 'Estable',
        } as never,
        '2026-03-14T10:00:00.000Z',
        {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-03-14T10:00:00.000Z',
            confirmedOccupant: { patientName: 'Paciente Uno', admissionDate: '2026-03-14' },
          },
        }
      )
    ).rejects.toThrow('únicamente una cama completa');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
