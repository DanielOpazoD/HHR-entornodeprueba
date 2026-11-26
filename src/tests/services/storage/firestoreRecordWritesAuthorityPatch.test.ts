// @vitest-environment node
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

vi.mock('@/services/utils/networkUtils', () => ({
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

describe('firestoreRecordWrites authority patch routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('routes authenticated partial updates through the clinical authority patch callable when enabled', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.pathology': 'Diagnostico atomico' },
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-partial-1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockGetFunctions).toHaveBeenCalled();
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'patchDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        expectedLastUpdated: '2026-03-14T10:00:00.000Z',
        mode: 'enforced',
        origin: 'direct_partial_update',
        patch: {
          'beds.R1.pathology': 'Diagnostico atomico',
        },
        syncContract: expect.objectContaining({
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-partial-1',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it('routes clinical patches through the authority callable even when repository invariants add derived fields', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.pathology': 'Diagnostico atomico',
        'beds.R1.fhir_resource': { resourceType: 'Patient', id: 'R1' },
        dateTimestamp: 1773446400000,
      },
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-partial-2',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'patchDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        patch: {
          'beds.R1.pathology': 'Diagnostico atomico',
        },
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.pathology'],
          mutationId: 'mutation-partial-2',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it('routes Qx classification patches through the clinical authority callable in enforced mode', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.surgicalComplication': true },
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.surgicalComplication'],
          mutationId: 'mutation-qx-1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'patchDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        patch: {
          'beds.R1.surgicalComplication': true,
        },
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.surgicalComplication'],
          mutationId: 'mutation-qx-1',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it('routes the bed and crib UPC journals and the bed override in a single authority call', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    const crib = {
      uciCriteria: [],
      utiCriteria: [],
      classification: null,
      evaluatedAt: '2026-03-14T10:05:00.000Z',
    };
    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.clinicalCrib.upcChecklist': crib,
        'beds.R1.upcChecklist': {
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-03-14T10:05:00.000Z',
        },
        'beds.R1.isUPC': true,
        'bedTypeOverrides.R1': 'UCI',
      },
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: [
            'beds.R1.upcChecklist',
            'beds.R1.isUPC',
            'bedTypeOverrides.R1',
            'beds.R1.clinicalCrib.upcChecklist',
          ],
          mutationId: 'mutation-upc-1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'patchDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        patch: expect.objectContaining({
          'beds.R1.clinicalCrib.upcChecklist': crib,
          'beds.R1.upcChecklist': expect.objectContaining({
            classification: 'UPC_UCI',
          }),
          'beds.R1.isUPC': true,
          'bedTypeOverrides.R1': 'UCI',
        }),
        syncContract: expect.objectContaining({
          changedPaths: [
            'beds.R1.upcChecklist',
            'beds.R1.isUPC',
            'bedTypeOverrides.R1',
            'beds.R1.clinicalCrib.upcChecklist',
          ],
          mutationId: 'mutation-upc-1',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it('routes structural bed edits through the preserving authority callable in enforced mode', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.patientName': 'Nombre estructural actualizado' },
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.patientName'],
          mutationId: 'mutation-structural-1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        mode: 'enforced',
        patch: {
          'beds.R1.patientName': 'Nombre estructural actualizado',
        },
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.patientName'],
          mutationId: 'mutation-structural-1',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it.each(['off', 'shadow'] as const)(
    'routes schema-v2 clinical patches through the preserving callable after rollback to %s',
    async serverMode => {
      mockGetCurrentUser.mockReturnValue({
        uid: 'nurse-1',
        email: 'nurse@example.com',
        isAnonymous: false,
      });
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ schemaVersion: 2, clinicalBatchMode: serverMode }),
      });

      await updateRecordPartial(
        '2026-03-14',
        { 'beds.R1.pathology': 'Diagnóstico protegido por schema v2' },
        '2026-03-14T10:00:00.000Z'
      );

      expect(mockAuthorityCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'enforced',
          patch: { 'beds.R1.pathology': 'Diagnóstico protegido por schema v2' },
        })
      );
      expect(updateDoc).not.toHaveBeenCalled();
    }
  );

  it('does not forward derived dateTimestamp alongside an authoritative structural bed patch', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.patientName': 'Nombre estructural actualizado',
        dateTimestamp: 1773446400000,
      },
      '2026-03-14T10:00:00.000Z'
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { 'beds.R1.patientName': 'Nombre estructural actualizado' },
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('fails closed when one update mixes a bed-tree edit with unrelated document fields', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await expect(
      updateRecordPartial(
        '2026-03-14',
        {
          'beds.R1.patientName': 'Nombre estructural actualizado',
          handoffNovedadesDayShift: 'Cambio no relacionado',
        },
        '2026-03-14T10:00:00.000Z'
      )
    ).rejects.toThrow('mezcla cambios de cama con otros campos');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('fails closed instead of dropping either side of a mixed clinical and structural patch', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await expect(
      updateRecordPartial(
        '2026-03-14',
        {
          'beds.R1.pathology': 'Diagnóstico clínico actualizado',
          'beds.R1.patientName': 'Nombre estructural actualizado',
        },
        '2026-03-14T10:00:00.000Z'
      )
    ).rejects.toThrow('mezcla campos clínicos y estructurales');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
