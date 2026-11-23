// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  firestoreWriteLoggerWarn,
  firestoreWriteLoggerError,
  mockEnsureUserRoleClaim,
  mockResolveFirebaseUserRole,
  mockGetCurrentUser,
  mockHttpsCallable,
  mockCallable,
  mockGetFunctions,
  occupiedSnapshot,
} from './firestoreRecordWritesTestSupport';
import { deleteDoc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createMockDocSnapshot } from '@/tests/factories/firestoreSdkMocks';
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
  updateRecordPartiallyAtomically,
} from '@/services/storage/firestore/firestoreWriteSupport';
import { withRetry } from '@/services/utils/networkUtils';

describe('firestoreRecordWrites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withRetry).mockImplementation(operation => operation());
    vi.mocked(getDoc).mockResolvedValue(createMockDocSnapshot(occupiedSnapshot().data()));
    mockGetCurrentUser.mockReturnValue(null);
    mockResolveFirebaseUserRole.mockResolvedValue(null);
    mockEnsureUserRoleClaim.mockResolvedValue(undefined);
    mockHttpsCallable.mockReturnValue(mockCallable);
    mockCallable.mockResolvedValue({ data: { success: true } });
  });

  it('blocks full-record writes that violate clinical episode authority', async () => {
    const duplicatedPatient = DataFactory.createMockPatient('R1', {
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: 'Paciente Duplicado',
      rut: '11.111.111-1',
      age: '40a',
      pathology: 'Diagnostico',
      admissionDate: '2026-03-14',
      admissionTime: '09:00',
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
      clinicalEpisodeId: 'ep-duplicado',
    });

    await expect(
      saveRecordToFirestore(
        DataFactory.createMockDailyRecord('2026-03-14', {
          beds: {
            R1: duplicatedPatient,
            R2: { ...duplicatedPatient, bedId: 'R2' },
          },
        })
      )
    ).rejects.toThrow('clinical authority');

    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('routes full-record saves through the clinical authority callable', async () => {
    await saveRecordToFirestore(
      DataFactory.createMockDailyRecord('2026-03-14', { beds: {} }),
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
      'saveDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockCallable).toHaveBeenCalledWith(
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

  it('updates existing records but never creates a day from a missing-target patch', async () => {
    await updateRecordPartial('2026-03-14', { status: 'ok' }, '2026-03-14T10:00:00.000Z');
    // The version is checked when committing, not by a read before the write.
    expect(assertFirestoreConcurrency).not.toHaveBeenCalled();
    expect(updateRecordPartiallyAtomically).toHaveBeenCalledWith(
      { date: '2026-03-14' },
      expect.objectContaining({ status: 'ok' }),
      '2026-03-14T10:00:00.000Z',
      'El registro ha sido modificado por otro usuario. Por favor recarga la página.',
      'partial update',
      { historyPolicy: 'skip', acceptsOtherVersion: expect.any(Function) }
    );
    expect(updateDoc).not.toHaveBeenCalled();

    vi.mocked(updateRecordPartiallyAtomically).mockRejectedValueOnce({ code: 'not-found' });
    await expect(updateRecordPartial('2026-03-15', { status: 'EDITED' })).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('offline, fails at the reachability read instead of waiting in a transaction', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce({ code: 'unavailable' });
    await expect(
      updateRecordPartial('2026-03-14', { status: 'ok' }, '2026-03-14T10:00:00.000Z')
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(updateRecordPartiallyAtomically).not.toHaveBeenCalled();
  });

  it.each([
    { nursesDayShift: ['SYNTHETIC NURSE'], tensDayShift: ['SYNTHETIC TENS'] },
    { 'staffingDetailsV1.day.nurses': [] },
    { nurseName: 'SYNTHETIC LEGACY NURSE' },
  ])('uses an atomic version check for staffing without a caller flag: %j', async patch => {
    await updateRecordPartial('2026-03-14', patch, '2026-03-14T10:00:00.000Z');

    expect(updateRecordPartiallyAtomically).toHaveBeenCalledWith(
      { date: '2026-03-14' },
      expect.objectContaining(patch),
      '2026-03-14T10:00:00.000Z',
      expect.stringContaining('dotación'),
      'staffing update',
      { historyPolicy: undefined }
    );
    expect(assertFirestoreConcurrency).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
  });

  it('lets atomic partial updates perform the only authoritative concurrency check', async () => {
    await updateRecordPartial(
      '2026-03-14',
      {
        rayenSync: {
          at: '2026-03-14T10:00:00.000Z',
          by: 'Operador HHR',
          runId: 'run-1',
          status: 'applied',
        },
      },
      '2026-03-14T10:00:00.000Z',
      { requireAtomicCas: true, historyPolicy: 'skip' }
    );
    expect(assertFirestoreConcurrency).not.toHaveBeenCalled();
    expect(updateRecordPartiallyAtomically).toHaveBeenCalledWith(
      { date: '2026-03-14' },
      expect.objectContaining({
        rayenSync: expect.objectContaining({ runId: 'run-1' }),
        lastUpdated: expect.anything(),
      }),
      '2026-03-14T10:00:00.000Z',
      'El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
      'movement reclassification',
      { historyPolicy: 'skip' }
    );
    expect(saveHistorySnapshot).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('refreshes the current user role claim and retries partial updates after permission-denied', async () => {
    const currentUser = {
      uid: 'specialist-1',
      email: 'specialist@example.com',
      isAnonymous: false,
    };
    mockGetCurrentUser.mockReturnValue(currentUser);
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    vi.mocked(updateRecordPartiallyAtomically)
      .mockRejectedValueOnce({
        code: 'permission-denied',
        message: 'Missing or insufficient permissions.',
      })
      .mockResolvedValueOnce({});

    await updateRecordPartial('2026-03-14', { status: 'ok' });

    expect(mockResolveFirebaseUserRole).toHaveBeenCalledWith(currentUser);
    expect(mockEnsureUserRoleClaim).toHaveBeenCalledWith(currentUser, 'doctor_specialist');
    expect(updateRecordPartiallyAtomically).toHaveBeenCalledTimes(2);
    expect(firestoreWriteLoggerWarn).toHaveBeenCalledWith(
      'Firestore write auth refresh succeeded',
      expect.objectContaining({
        date: '2026-03-14',
        resolvedRole: 'doctor_specialist',
        uid: 'specialist-1',
      })
    );
  });

  it('sends a doctor_specialist clinical-events patch through the patch authority', async () => {
    mockGetCurrentUser.mockReturnValue({
      uid: 'specialist-2',
      email: 'specialist@example.com',
      isAnonymous: false,
    });
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');

    await updateRecordPartial('2026-03-21', {
      'beds.R4.clinicalEvents': [
        {
          id: 'event-1',
          name: 'Procedimiento',
          date: '2026-03-21',
          createdAt: '2026-03-21T09:00:00.000Z',
        },
      ],
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'patchDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockCallable).toHaveBeenCalledOnce();
    expect(updateRecordPartiallyAtomically).not.toHaveBeenCalled();
  });

  it('rethrows write failures that are not recoverable', async () => {
    vi.mocked(updateRecordPartiallyAtomically).mockRejectedValueOnce(new Error('boom'));
    await expect(updateRecordPartial('2026-03-16', { status: 'broken' })).rejects.toThrow('boom');

    mockCallable.mockRejectedValueOnce(new Error('save failed'));
    await expect(
      saveRecordToFirestore(
        DataFactory.createMockDailyRecord('2026-03-17', { beds: {} }),
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

    await moveRecordToTrash(DataFactory.createMockDailyRecord('2026-03-14', { beds: {} }));
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
      moveRecordToTrash(DataFactory.createMockDailyRecord('2026-03-18', { beds: {} }))
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

    await saveRecordToFirestore(DataFactory.createMockDailyRecord('2026-03-19', { beds: {} }));
    await updateRecordPartial('2026-03-19', { status: 'ok' });
    await deleteRecordFromFirestore('2026-03-19');

    expect(mockCallable).toHaveBeenCalled();
    expect(updateRecordPartiallyAtomically).toHaveBeenCalled();
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
