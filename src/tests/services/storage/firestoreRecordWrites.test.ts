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

import { deleteDoc, setDoc, updateDoc } from 'firebase/firestore';
import {
  deleteRecordFromFirestore,
  moveRecordToTrash,
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import {
  assertFirestoreConcurrency,
  createDeletedRecordRef,
  saveHistorySnapshot,
  saveRecordAtomically,
} from '@/services/storage/firestore/firestoreWriteSupport';
import { withRetry } from '@/utils/networkUtils';

describe('firestoreRecordWrites', () => {
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

  it('saves full records after concurrency and history checks', async () => {
    await saveRecordToFirestore({
      date: '2026-03-14',
      beds: {},
    } as never);

    expect(saveRecordAtomically).toHaveBeenCalledWith(
      { date: '2026-03-14' },
      expect.objectContaining({ date: '2026-03-14' }),
      undefined,
      'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
      'save',
      undefined
    );
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('blocks full-record writes that violate clinical episode authority', async () => {
    const duplicatedPatient = {
      bedId: 'R1',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: 'Paciente Duplicado',
      rut: '11.111.111-1',
      age: '40a',
      pathology: 'Diagnostico',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2026-03-14',
      admissionTime: '09:00',
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
      clinicalEpisodeId: 'ep-duplicado',
    };

    await expect(
      saveRecordToFirestore({
        date: '2026-03-14',
        beds: {
          R1: duplicatedPatient,
          R2: { ...duplicatedPatient, bedId: 'R2' },
        },
        discharges: [],
        transfers: [],
        cma: [],
      } as never)
    ).rejects.toThrow('clinical authority');

    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('runs shadow authority validation without blocking direct full-record saves', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'shadow';
    mockGetCurrentUser.mockReturnValue({
      uid: 'nurse-1',
      email: 'nurse@example.com',
      isAnonymous: false,
    });
    mockSpecialistCallable.mockRejectedValueOnce(new Error('shadow unavailable'));

    await saveRecordToFirestore(
      {
        date: '2026-03-16',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
      } as never,
      '2026-03-16T10:00:00.000Z'
    );

    expect(mockSpecialistCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-16',
        dryRun: true,
        expectedLastUpdated: '2026-03-16T10:00:00.000Z',
        mode: 'shadow',
        origin: 'shadow_save',
        record: expect.objectContaining({ date: '2026-03-16' }),
      })
    );
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Daily record authority shadow validation failed',
      expect.objectContaining({ date: '2026-03-16', error: expect.any(Error) })
    );
    expect(saveRecordAtomically).toHaveBeenCalledWith(
      { date: '2026-03-16' },
      expect.objectContaining({ date: '2026-03-16' }),
      '2026-03-16T10:00:00.000Z',
      'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
      'save',
      undefined
    );
  });

  it('routes authenticated full-record saves through the clinical authority callable when enabled', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_CALLABLE =
      'true';
    mockGetCurrentUser.mockReturnValue({
      uid: 'doctor-1',
      email: 'doctor@example.com',
      isAnonymous: false,
    });

    await saveRecordToFirestore(
      {
        date: '2026-03-14',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
      } as never,
      '2026-03-14T10:00:00.000Z',
      {
        syncContract: {
          expectedVersion: '2026-03-14T10:00:00.000Z',
          baseRevision: 7,
          changedPaths: ['*'],
          mutationId: 'mutation-full-save-1',
        },
      }
    );

    expect(mockGetFunctions).toHaveBeenCalled();
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'saveDailyRecordWithClinicalAuthority'
    );
    expect(mockSpecialistCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-03-14',
        expectedLastUpdated: '2026-03-14T10:00:00.000Z',
        mode: 'enforced',
        origin: 'direct_save',
        record: expect.objectContaining({
          date: '2026-03-14',
        }),
        syncContract: expect.objectContaining({
          expectedVersion: '2026-03-14T10:00:00.000Z',
          baseRevision: 7,
          changedPaths: ['*'],
          mutationId: 'mutation-full-save-1',
        }),
      })
    );
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('updates partial records and falls back to setDoc when update target is missing', async () => {
    await updateRecordPartial('2026-03-14', { status: 'ok' } as never, '2026-03-14T10:00:00.000Z');
    expect(assertFirestoreConcurrency).toHaveBeenCalledWith(
      { date: '2026-03-14' },
      '2026-03-14T10:00:00.000Z',
      'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
      'partial update',
      { toleranceMs: 0, failClosed: true }
    );
    expect(updateDoc).toHaveBeenCalledTimes(1);

    vi.mocked(updateDoc).mockRejectedValueOnce({ code: 'not-found' });
    await updateRecordPartial('2026-03-15', { status: 'created' } as never);
    expect(setDoc).toHaveBeenCalledWith(
      { date: '2026-03-15' },
      expect.objectContaining({ status: 'created' }),
      { merge: true }
    );
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Firestore write fallback: partialUpdateNotFound',
      expect.objectContaining({ date: '2026-03-15' })
    );
  });

  it('refreshes the current user role claim and retries partial updates after permission-denied', async () => {
    const currentUser = {
      uid: 'specialist-1',
      email: 'specialist@example.com',
      isAnonymous: false,
    };
    mockGetCurrentUser.mockReturnValue(currentUser);
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    vi.mocked(updateDoc)
      .mockRejectedValueOnce({
        code: 'permission-denied',
        message: 'Missing or insufficient permissions.',
      })
      .mockResolvedValueOnce(undefined as never);

    await updateRecordPartial('2026-03-14', { status: 'ok' } as never);

    expect(mockResolveFirebaseUserRole).toHaveBeenCalledWith(currentUser);
    expect(mockEnsureUserRoleClaim).toHaveBeenCalledWith(currentUser, 'doctor_specialist');
    expect(updateDoc).toHaveBeenCalledTimes(2);
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Firestore write auth refresh succeeded',
      expect.objectContaining({
        date: '2026-03-14',
        resolvedRole: 'doctor_specialist',
        uid: 'specialist-1',
      })
    );
  });

  it('routes specialist-scoped patches through the callable backend for doctor_specialist users', async () => {
    const currentUser = {
      uid: 'specialist-2',
      email: 'specialist@example.com',
      isAnonymous: false,
    };
    mockGetCurrentUser.mockReturnValue(currentUser);
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');

    await updateRecordPartial('2026-03-20', {
      'beds.R4.medicalHandoffEntries': [{ id: 'entry-1', note: 'Seguimiento' }],
      'beds.R4.medicalHandoffNote': 'Seguimiento',
      'beds.R4.medicalHandoffAudit': { currentStatus: 'updated_by_specialist' },
    } as never);

    expect(mockGetFunctions).toHaveBeenCalled();
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'updateSpecialistMedicalHandoff'
    );
    expect(mockSpecialistCallable).toHaveBeenCalledWith({
      date: '2026-03-20',
      patch: {
        'beds.R4.medicalHandoffEntries': [{ id: 'entry-1', note: 'Seguimiento' }],
        'beds.R4.medicalHandoffNote': 'Seguimiento',
        'beds.R4.medicalHandoffAudit': { currentStatus: 'updated_by_specialist' },
      },
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('keeps direct Firestore writes for the same scoped patch when the user is not doctor_specialist', async () => {
    const currentUser = {
      uid: 'admin-1',
      email: 'admin@example.com',
      isAnonymous: false,
    };
    mockGetCurrentUser.mockReturnValue(currentUser);
    mockResolveFirebaseUserRole.mockResolvedValue('admin');

    await updateRecordPartial('2026-03-21', {
      'beds.R4.medicalHandoffEntries': [{ id: 'entry-1', note: 'Seguimiento admin' }],
      'beds.R4.medicalHandoffNote': 'Seguimiento admin',
      'beds.R4.medicalHandoffAudit': { currentStatus: 'updated_by_specialist' },
    } as never);

    expect(mockGetFunctions).not.toHaveBeenCalled();
    expect(mockSpecialistCallable).not.toHaveBeenCalled();
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('rethrows write failures that are not recoverable', async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('boom'));
    await expect(updateRecordPartial('2026-03-16', { status: 'broken' } as never)).rejects.toThrow(
      'boom'
    );

    vi.mocked(saveRecordAtomically).mockRejectedValueOnce(new Error('save failed'));
    await expect(
      saveRecordToFirestore(
        {
          date: '2026-03-17',
          beds: {},
        } as never,
        '2026-03-16T10:00:00.000Z'
      )
    ).rejects.toThrow('save failed');

    expect(firestoreWriteLoggerError).toHaveBeenCalledWith(
      'Firestore write failed: save',
      expect.objectContaining({
        date: '2026-03-17',
        error: expect.any(Error),
      })
    );
  });

  it('deletes records and moves them to trash', async () => {
    await deleteRecordFromFirestore('2026-03-14');
    expect(deleteDoc).toHaveBeenCalledWith({ date: '2026-03-14' });

    await moveRecordToTrash({
      date: '2026-03-14',
      beds: {},
    } as never);
    expect(setDoc).toHaveBeenCalledWith(
      { trashRef: '2026-03-14' },
      expect.objectContaining({
        date: '2026-03-14',
        originalDate: '2026-03-14',
      })
    );
  });

  it('rethrows delete and trash failures', async () => {
    vi.mocked(deleteDoc).mockRejectedValueOnce(new Error('delete failed'));
    await expect(deleteRecordFromFirestore('2026-03-18')).rejects.toThrow('delete failed');

    vi.mocked(setDoc).mockRejectedValueOnce(new Error('trash failed'));
    await expect(
      moveRecordToTrash({
        date: '2026-03-18',
        beds: {},
      } as never)
    ).rejects.toThrow('trash failed');

    expect(createDeletedRecordRef).toHaveBeenCalledWith('2026-03-18');
    expect(withRetry).toHaveBeenCalled();
    expect(firestoreWriteLoggerError).toHaveBeenCalledWith(
      'Firestore write failed: moveToTrash',
      expect.objectContaining({
        date: '2026-03-18',
        error: expect.any(Error),
      })
    );
  });

  it('wires retry callbacks for save, partial update and delete operations', async () => {
    vi.mocked(withRetry).mockImplementation(
      async (
        operation: () => Promise<unknown> | unknown,
        options?: { onRetry?: (error: unknown, attempt: number, delay: number) => void }
      ) => {
        options?.onRetry?.(new Error('retry'), 1, 0);
        return operation();
      }
    );

    await saveRecordToFirestore({
      date: '2026-03-19',
      beds: {},
    } as never);
    await updateRecordPartial('2026-03-19', { status: 'ok' } as never);
    await deleteRecordFromFirestore('2026-03-19');

    expect(saveRecordAtomically).toHaveBeenCalled();
    expect(updateDoc).toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalled();
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Firestore write retry: save',
      expect.objectContaining({ attempt: 1, date: '2026-03-19', error: expect.any(Error) })
    );
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Firestore write retry: partialUpdate',
      expect.objectContaining({ attempt: 1, date: '2026-03-19', error: expect.any(Error) })
    );
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Firestore write retry: delete',
      expect.objectContaining({ attempt: 1, date: '2026-03-19', error: expect.any(Error) })
    );
  });
});
