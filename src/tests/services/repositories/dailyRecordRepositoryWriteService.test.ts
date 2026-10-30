import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';
import {
  buildPatient,
  buildRecord,
} from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(async record => ({
    ok: true,
    operation: 'save',
    store: 'indexeddb',
    dates: [record.date],
  })),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
}));

vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn(),
  isRetryableSyncError: vi.fn(),
  queueSyncTask: vi.fn(),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn(),
  releaseDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
  renewDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: vi.fn((record: DailyRecord) => ({ record, patches: {} })),
}));

vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: vi.fn((record: DailyRecord) => record),
}));

vi.mock('@/services/utils/fhirMappers', () => ({
  mapPatientToFhir: vi.fn(() => ({})),
}));

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: {
    upsertPatient: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictAutoMerged: vi.fn().mockResolvedValue(undefined),
}));

import {
  save,
  saveDetailed,
  updatePartial,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  getRecordForDate as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import {
  saveRecordToFirestore,
  updateRecordPartial as updateRecordPartialToFirestore,
} from '@/services/storage/firestore/firestoreRecordWrites';
import {
  ackDailyRecordSyncTask,
  isRetryableSyncError,
  releaseDailyRecordPreOutboxHold,
  queueDailyRecordSyncTaskWithLocalRecord as queueSyncTask,
} from '@/services/storage/sync';

const expectSyncContract = (expectedVersion: string, changedPaths: string[]) =>
  expect.objectContaining({
    syncContract: expect.objectContaining({
      expectedVersion,
      changedPaths,
      recordRevision: expect.any(String),
    }),
  });

const expectDurableRetry = (expectedVersion: string, paths: string[], remoteCallOrder: number) => {
  expect(queueSyncTask).toHaveBeenCalledOnce();
  const [record, metadata = {}] = vi.mocked(queueSyncTask).mock.calls[0];
  expect(metadata).toEqual(expectSyncContract(expectedVersion, paths));
  expect(metadata.syncContract?.mutationId).toEqual(expect.any(String));
  expect(releaseDailyRecordPreOutboxHold).toHaveBeenCalledExactlyOnceWith(
    record,
    metadata.syncContract
  );
  expect(vi.mocked(queueSyncTask).mock.invocationCallOrder[0]).toBeLessThan(remoteCallOrder);
  expect(ackDailyRecordSyncTask).not.toHaveBeenCalled();
};

describe('dailyRecordRepositoryWriteService outbox fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queueSyncTask).mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
    vi.mocked(ackDailyRecordSyncTask).mockResolvedValue(true);
  });

  it('retains the single durable full record after a retryable remote failure', async () => {
    vi.mocked(saveRecordToFirestore).mockRejectedValueOnce(new Error('Network timeout'));
    vi.mocked(isRetryableSyncError).mockReturnValue(true);

    const record = buildRecord('2026-02-19');
    const result = await saveDetailed(record);
    expect(result.outcome).toBe('queued');
    expect(result.queuedForRetry).toBe(true);

    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-02-19' }),
      expect.objectContaining({
        contexts: ['clinical', 'staffing', 'movements', 'handoff', 'metadata'],
      }),
      expect.objectContaining({ deferProcessing: true, preOutboxHoldReason: 'awaiting_remote_ack' })
    );
    expectDurableRetry(
      record.lastUpdated,
      ['*'],
      vi.mocked(saveRecordToFirestore).mock.invocationCallOrder[0]
    );
  });

  it('surfaces sync queue saturation as unrecoverable instead of pretending the retry was queued', async () => {
    vi.mocked(saveRecordToFirestore).mockRejectedValueOnce(new Error('Network timeout'));
    vi.mocked(isRetryableSyncError).mockReturnValue(true);
    vi.mocked(queueSyncTask).mockResolvedValueOnce({
      accepted: false,
      mode: 'rejected_backpressure',
      pendingTasks: 192,
      maxPendingTasks: 192,
    });

    const result = await saveDetailed(buildRecord('2026-02-20'));

    expect(result.outcome).toBe('unrecoverable');
    expect(result.queuedForRetry).toBe(false);
    expect(result.consistencyState).toBe('unrecoverable');
    expect(result.userSafeMessage).toContain('cola de sincronización alcanzó su límite');
  });

  it('blocks full save when admissionDate falls outside the first-seen window', async () => {
    const record = buildRecord('2026-03-05');
    record.beds = {
      R1: {
        ...buildPatient('R1', 'Paciente Invalido'),
        firstSeenDate: '2026-03-05',
        admissionDate: '2026-02-15',
      },
    };

    const result = await saveDetailed(record);

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_validation');
    expect(result.blockingReason).toBe('validation');
    expect(saveToIndexedDB).not.toHaveBeenCalled();
  });

  it('retains the single durable patched record after a retryable remote failure', async () => {
    const existing = buildRecord('2026-02-18');
    existing.beds = {
      R1: buildPatient('R1', 'Paciente Anterior'),
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(existing);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(
      new Error('Network unavailable')
    );
    vi.mocked(isRetryableSyncError).mockReturnValue(true);

    await updatePartial('2026-02-18', {
      'beds.R1.patientName': 'Paciente Nuevo',
    });

    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-02-18',
        beds: expect.objectContaining({
          R1: expect.objectContaining({ patientName: 'Paciente Nuevo' }),
        }),
      }),
      expect.objectContaining({
        contexts: ['clinical'],
      }),
      expect.objectContaining({ deferProcessing: true, preOutboxHoldReason: 'awaiting_remote_ack' })
    );
    expectDurableRetry(
      existing.lastUpdated,
      ['beds.R1.patientName'],
      vi.mocked(updateRecordPartialToFirestore).mock.invocationCallOrder[0]
    );
  });

  it('returns blocked outcome when partial update has no local record', async () => {
    const consoleSpies = suppressConsole(['warn']);
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);

    try {
      const result = await updatePartialDetailed('2026-02-18', {
        'beds.R1.patientName': 'Paciente Nuevo',
      });

      expect(result.outcome).toBe('blocked');
      expect(result.savedLocally).toBe(false);
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('throws from legacy updatePartial when the detailed partial outcome is blocked', async () => {
    const consoleSpies = suppressConsole(['warn']);
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);

    try {
      await expect(
        updatePartial('2026-02-18', {
          'beds.R1.patientName': 'Paciente Nuevo',
        })
      ).rejects.toThrow('No se encontró un registro local válido para aplicar el cambio.');
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('hydrates a remote base record before partial update when local cache is missing', async () => {
    const remote = buildRecord('2026-02-18');
    remote.lastUpdated = '2026-02-18T09:00:00.000Z';
    remote.beds = {
      R2: buildPatient('R2', 'Paciente Remoto'),
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(remote);

    const result = await updatePartialDetailed('2026-02-18', {
      'beds.R2.patientName': 'Paciente Nuevo',
    });

    expect(result.outcome).toBe('clean');
    expect(result.savedLocally).toBe(true);
    expect(result.updatedRemotely).toBe(true);
    // The fetched base goes through admission: it never replaces a copy a pending write holds.
    expect(saveToIndexedDB).toHaveBeenCalledWith(remote, {
      preserveUnresolvedWrites: true,
      expectedBase: { kind: 'stored', record: null },
    });
    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-02-18',
        beds: expect.objectContaining({
          R2: expect.objectContaining({ patientName: 'Paciente Nuevo' }),
        }),
      }),
      expect.objectContaining({
        contexts: ['clinical'],
        origin: 'direct_queue',
        syncContract: expect.objectContaining({ changedPaths: ['beds.R2.patientName'] }),
      }),
      expect.objectContaining({ deferProcessing: true, holdForMs: expect.any(Number) })
    );
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        'beds.R2.patientName': 'Paciente Nuevo',
      }),
      '2026-02-18T09:00:00.000Z',
      expectSyncContract('2026-02-18T09:00:00.000Z', ['beds.R2.patientName'])
    );
  });

  it('blocks partial admissionDate edits after the first observed day', async () => {
    const current = buildRecord('2026-03-05');
    current.beds = {
      R1: {
        ...buildPatient('R1', 'Paciente Persistido'),
        firstSeenDate: '2026-03-01',
        admissionDate: '2026-03-01',
      },
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    const result = await updatePartialDetailed('2026-03-05', {
      'beds.R1.admissionDate': '2026-03-02',
    });

    expect(result.outcome).toBe('blocked');
    expect(result.consistencyState).toBe('blocked_validation');
    expect(result.blockingReason).toBe('validation');
    expect(saveToIndexedDB).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).not.toHaveBeenCalled();
  });

  it('allows unrelated bed edits when an existing episode already has a suspicious admissionDate', async () => {
    const current = buildRecord('2026-05-08');
    current.beds = {
      NEO1: {
        ...buildPatient('NEO1', 'Nayeli Hereveri Martinez'),
        rut: '24.029.332-3',
        firstSeenDate: '2026-05-08',
        admissionDate: '2026-05-01',
      },
      R4: {
        ...buildPatient('R4', ''),
        rut: '',
        firstSeenDate: undefined,
        admissionDate: '',
      },
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    const result = await updatePartialDetailed('2026-05-08', {
      'beds.R4.patientName': 'Paciente Nuevo',
      'beds.R4.rut': '22.222.222-2',
      'beds.R4.firstSeenDate': '2026-05-08',
      'beds.R4.admissionDate': '2026-05-08',
    });

    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-05-08',
      expect.objectContaining({
        'beds.R4.patientName': 'Paciente Nuevo',
        'beds.R4.rut': '22.222.222-2',
      }),
      current.lastUpdated,
      expectSyncContract(current.lastUpdated, [
        'beds.R4.patientName',
        'beds.R4.rut',
        'beds.R4.firstSeenDate',
        'beds.R4.admissionDate',
      ])
    );
  });

  it('persists explicit firstSeenDate clearing when a stale episode bed is emptied', async () => {
    const current = buildRecord('2026-05-08');
    current.beds = {
      R2: {
        ...buildPatient('R2', 'Daniel S Damiani'),
        rut: '17.752.753-K',
        firstSeenDate: '2026-05-03',
        admissionDate: '2026-05-01',
        location: 'R2',
      },
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    const result = await updatePartialDetailed('2026-05-08', {
      'beds.R2': {
        bedId: 'R2',
        patientName: '',
        rut: '',
        firstSeenDate: '',
        admissionDate: '',
        admissionTime: '',
        location: 'R2',
      },
    });

    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-05-08',
      expect.objectContaining({
        'beds.R2': expect.objectContaining({
          patientName: '',
          rut: '',
          firstSeenDate: '',
          admissionDate: '',
        }),
      }),
      current.lastUpdated,
      expectSyncContract(current.lastUpdated, ['beds.R2'])
    );
  });

  it('does not add a retry queue task when Firestore error is non-retryable', async () => {
    vi.mocked(saveRecordToFirestore).mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });
    vi.mocked(isRetryableSyncError).mockReturnValue(false);

    await save(buildRecord('2026-02-17'));

    expect(queueSyncTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueSyncTask).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ origin: 'direct_queue' })
    );
  });

  it('passes local lastUpdated as concurrency base for partial remote update', async () => {
    const current = buildRecord('2026-02-13');
    current.lastUpdated = '2026-02-13T08:00:00.000Z';
    current.beds = { R1: buildPatient('R1', 'Paciente local') };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    await updatePartial('2026-02-13', {
      'beds.R1.patientName': 'Paciente remoto seguro',
    });

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-13',
      expect.any(Object),
      '2026-02-13T08:00:00.000Z',
      expectSyncContract('2026-02-13T08:00:00.000Z', ['beds.R1.patientName'])
    );
  });

  it('preserves a valid persisted dateTimestamp during partial updates before the remote write', async () => {
    const current = buildRecord('2026-02-11');
    current.dateTimestamp = Date.parse('2026-02-11T00:00:00.000Z');
    current.beds = { R1: buildPatient('R1', 'Paciente local') };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    await updatePartial('2026-02-11', {
      medicalHandoffNovedades: 'Nota especialista',
    });

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-11',
      expect.objectContaining({
        medicalHandoffNovedades: 'Nota especialista',
        dateTimestamp: Date.parse('2026-02-11T00:00:00.000Z'),
      }),
      current.lastUpdated,
      expectSyncContract(current.lastUpdated, ['medicalHandoffNovedades'])
    );
  });

  it('keeps dateTimestamp in partial remote patches to repair legacy Firestore records', async () => {
    const current = buildRecord('2026-02-10');
    current.dateTimestamp = Date.parse('2026-02-10T00:00:00Z');
    current.beds = { R1: buildPatient('R1', 'Paciente local') };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    await updatePartial('2026-02-10', {
      'beds.R1.patientName': 'Paciente actualizado',
    });

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-10',
      expect.objectContaining({
        'beds.R1.patientName': 'Paciente actualizado',
        dateTimestamp: Date.parse('2026-02-10T00:00:00Z'),
      }),
      current.lastUpdated,
      expectSyncContract(current.lastUpdated, ['beds.R1.patientName'])
    );
  });

  it('adds clinical crib fhir patch when nested crib data changes', async () => {
    const current = buildRecord('2026-02-12');
    current.beds = {
      R1: {
        ...buildPatient('R1', 'Madre'),
        clinicalCrib: buildPatient('C1', 'Recien nacido'),
      },
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    await updatePartial('2026-02-12', {
      'beds.R1.clinicalCrib.patientName': 'Recien nacido actualizado',
    });

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-12',
      expect.objectContaining({
        'beds.R1.clinicalCrib.patientName': 'Recien nacido actualizado',
        'beds.R1.clinicalCrib.fhir_resource': expect.any(Object),
      }),
      current.lastUpdated,
      expectSyncContract(current.lastUpdated, ['beds.R1.clinicalCrib.patientName'])
    );
  });
});
