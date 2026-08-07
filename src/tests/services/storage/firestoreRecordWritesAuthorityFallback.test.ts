import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  firestoreWriteLoggerWarn,
  firestoreWriteLoggerError,
  mockAssertFirestoreConcurrency,
  mockFlattenObject,
  mockGetDoc,
} = vi.hoisted(() => ({
  firestoreWriteLoggerWarn: vi.fn(),
  firestoreWriteLoggerError: vi.fn(),
  mockAssertFirestoreConcurrency: vi.fn(),
  mockFlattenObject: vi.fn((value: Record<string, unknown>) => value),
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

    const result = await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.vitalSigns': { heartRate: 80 },
        'beds.R1.fhir_resource': { resourceType: 'Patient' },
        'beds.R1.clinicalEpisodeId': 'episode-1',
        dateTimestamp: 123,
      } as never,
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
    expect(mockFlattenObject).toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('normalizes nested and dotted-container Rayen patches into atomic guarded paths', async () => {
    const rayenClinicalWriteGuard = {
      runId: 'run-nested-1',
      importMode: 'preview' as const,
      clinicalBatchMode: 'shadow' as const,
      revision: 4,
      sourceDate: '2026-03-14',
      recordScope: 'run' as const,
    };
    const vitalSigns = { heartRate: 82 };
    const cribScores = { braden: { score: 17 } };

    await updateRecordPartial(
      '2026-03-14',
      {
        beds: {
          R1: {
            vitalSigns,
            fhir_resource: { resourceType: 'Patient' },
            clinicalCrib: {
              evaluationScores: cribScores,
              clinicalEpisodeId: 'crib-episode-1',
            },
          },
        },
        dateTimestamp: 123,
      } as never,
      '2026-03-14T10:00:00.000Z',
      { rayenClinicalWriteGuard, historyPolicy: 'skip' }
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          'beds.R1.vitalSigns': vitalSigns,
          'beds.R1.clinicalCrib.evaluationScores': cribScores,
        },
        rayenClinicalWriteGuard,
      })
    );
    expect(mockFlattenObject).toHaveBeenCalled();

    const secondVitalSigns = { heartRate: 84 };
    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R2': {
          vitalSigns: secondVitalSigns,
          patientName: 'No debe salir',
        },
      } as never,
      '2026-03-14T10:01:00.000Z',
      { rayenClinicalWriteGuard, historyPolicy: 'skip' }
    );

    expect(mockAuthorityCallable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patch: { 'beds.R2.vitalSigns': secondVitalSigns },
        rayenClinicalWriteGuard,
      })
    );
  });

  it('keeps a historical CUDYR value atomic when routing through the guarded authority', async () => {
    const rayenClinicalWriteGuard = {
      runId: 'run-historical-1',
      importMode: 'preview' as const,
      clinicalBatchMode: 'shadow' as const,
      revision: 4,
      sourceDate: '2026-03-15',
      recordScope: 'historical' as const,
    };
    const cudyr = {
      category: 'B1',
      recordedDate: '2026-03-14',
      source: 'rayen',
    };

    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.evaluationScores.cudyr': cudyr,
        'beds.R1.fhir_resource': { resourceType: 'Patient' },
        dateTimestamp: 123,
      } as never,
      '2026-03-14T10:00:00.000Z',
      { rayenClinicalWriteGuard, historyPolicy: 'skip' }
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { 'beds.R1.evaluationScores.cudyr': cudyr },
        rayenClinicalWriteGuard,
      })
    );
    expect(mockFlattenObject).toHaveBeenCalled();
  });

  it('normalizes nested historical CUDYR without forwarding adjacent score fields', async () => {
    const rayenClinicalWriteGuard = {
      runId: 'run-historical-nested-1',
      importMode: 'preview' as const,
      clinicalBatchMode: 'shadow' as const,
      revision: 4,
      sourceDate: '2026-03-15',
      recordScope: 'historical' as const,
    };
    const cudyr = { category: 'B2', recordedDate: '2026-03-14', source: 'rayen' };

    await updateRecordPartial(
      '2026-03-14',
      {
        'beds.R1.evaluationScores': {
          cudyr,
          braden: { score: 18 },
        },
      } as never,
      '2026-03-14T10:00:00.000Z',
      { rayenClinicalWriteGuard, historyPolicy: 'skip' }
    );

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { 'beds.R1.evaluationScores.cudyr': cudyr },
        rayenClinicalWriteGuard,
      })
    );
  });
});
