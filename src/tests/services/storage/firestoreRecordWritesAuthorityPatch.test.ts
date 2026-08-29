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

describe('firestoreRecordWrites authority patch routing', () => {
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

  it('routes authenticated partial updates through the clinical authority patch callable when enabled', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_CALLABLE =
      'true';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.pathology': 'Diagnostico atomico' } as never,
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
      'patchDailyRecordWithClinicalAuthority'
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
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
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
      } as never,
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
      'patchDailyRecordWithClinicalAuthority'
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
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.surgicalComplication': true } as never,
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
      'patchDailyRecordWithClinicalAuthority'
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

  it('routes UPC checklist patches with derived bed type overrides through the authority callable', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.upcChecklist': {
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-03-14T10:05:00.000Z',
        },
        'beds.R1.isUPC': true,
        'bedTypeOverrides.R1': 'UCI',
      } as never,
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          changedPaths: ['beds.R1.upcChecklist', 'beds.R1.isUPC', 'bedTypeOverrides.R1'],
          mutationId: 'mutation-upc-1',
          clientId: 'client-1',
          tabId: 'tab-1',
        },
      }
    );

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'patchDailyRecordWithClinicalAuthority'
    );
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        patch: expect.objectContaining({
          'beds.R1.upcChecklist': expect.objectContaining({
            classification: 'UPC_UCI',
          }),
          'beds.R1.isUPC': true,
          'bedTypeOverrides.R1': 'UCI',
        }),
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.upcChecklist', 'beds.R1.isUPC', 'bedTypeOverrides.R1'],
          mutationId: 'mutation-upc-1',
        }),
      })
    );
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it('routes structural bed edits through the preserving authority callable in enforced mode', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });

    await updateRecordPartial(
      '2026-03-14',
      { 'beds.R1.patientName': 'Nombre estructural actualizado' } as never,
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
          },
        }
      )
    ).rejects.toThrow('únicamente una cama completa');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it.each([
    ['off', 'client_only'],
    ['shadow', 'shadow'],
  ] as const)(
    'routes schema-v2 clinical patches through the preserving callable after rollback to %s',
    async (serverMode, clientMode) => {
      (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
        clientMode;
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
        { 'beds.R1.pathology': 'Diagnóstico protegido por schema v2' } as never,
        '2026-03-14T10:00:00.000Z'
      );

      expect(mockAuthorityCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'shadow',
          patch: { 'beds.R1.pathology': 'Diagnóstico protegido por schema v2' },
        })
      );
      expect(updateDoc).not.toHaveBeenCalled();
    }
  );

  it('does not forward derived dateTimestamp alongside an authoritative structural bed patch', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
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
      } as never,
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
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
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
        } as never,
        '2026-03-14T10:00:00.000Z'
      )
    ).rejects.toThrow('mezcla cambios de cama con otros campos');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('fails closed instead of dropping either side of a mixed clinical and structural patch', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
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
        } as never,
        '2026-03-14T10:00:00.000Z'
      )
    ).rejects.toThrow('mezcla campos clínicos y estructurales');

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
