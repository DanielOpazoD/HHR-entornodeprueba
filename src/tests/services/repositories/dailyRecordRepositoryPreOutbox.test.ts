import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
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

import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  ackDailyRecordSyncTask,
  queueDailyRecordSyncTaskWithLocalRecord as queueSyncTask,
} from '@/services/storage/sync';

const buildRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T00:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
});

describe('dailyRecordRepositoryWriteService pre-outbox', () => {
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

  it('prequeues full saves with the same sync contract sent to the remote authority write', async () => {
    const record = buildRecord('2026-02-21');
    record.lastUpdated = '2026-02-21T08:00:00.000Z';

    await saveDetailed(record, '2026-02-21T07:55:00.000Z');

    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-02-21' }),
      expect.objectContaining({
        contexts: ['clinical', 'staffing', 'movements', 'handoff', 'metadata'],
        origin: 'direct_queue',
        syncContract: expect.objectContaining({
          expectedVersion: '2026-02-21T07:55:00.000Z',
          changedPaths: ['*'],
          recordRevision: '2026-02-21T08:00:00.000Z',
          mutationId: expect.any(String),
        }),
      }),
      expect.objectContaining({ deferProcessing: true, holdForMs: expect.any(Number) })
    );
    expect(saveRecordToFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-02-21' }),
      '2026-02-21T07:55:00.000Z',
      expect.objectContaining({
        syncContract: expect.objectContaining({
          expectedVersion: '2026-02-21T07:55:00.000Z',
          changedPaths: ['*'],
          recordRevision: '2026-02-21T08:00:00.000Z',
        }),
      })
    );
  });

  it('does not mutate local state or queue a stale structural plan when remote CAS rejects it', async () => {
    const record = buildRecord('2026-02-21');
    record.lastUpdated = '2026-02-21T08:00:00.000Z';
    const conflict = Object.assign(new Error('remote revision changed'), {
      name: 'ConcurrencyError',
    });
    vi.mocked(saveRecordToFirestore).mockRejectedValueOnce(conflict);

    await expect(
      saveDetailed(record, '2026-02-21T07:55:00.000Z', {
        requireConfirmedRecord: true,
        rayenStructuralWriteGuard: true,
      })
    ).rejects.toBe(conflict);

    expect(saveRecordToFirestore).toHaveBeenCalledOnce();
    expect(queueSyncTask).not.toHaveBeenCalled();
    expect(saveToIndexedDB).not.toHaveBeenCalled();
  });
});
