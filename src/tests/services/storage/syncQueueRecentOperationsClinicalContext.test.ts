import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
  };
});

vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>();
  return {
    ...actual,
    getRecordDocRef: vi.fn(() => ({ id: 'sync-clinical-context-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

import { getDoc, setDoc } from 'firebase/firestore';
import {
  listRecentSyncQueueOperations,
  processSyncQueue,
  queueSyncTask,
} from '@/services/storage/sync';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('syncQueueRecentOperationsClinicalContext', () => {
  const makeRecord = (date: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:10:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  });

  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    resetSyncMutationIdentityForTests();
    vi.clearAllMocks();
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as Awaited<ReturnType<typeof getDoc>>);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('keeps non-sensitive clinical patch context in recent failed sync operations', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    const record = makeRecord('2025-01-16');
    record.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente no debe aparecer',
      rut: '44.444.444-4',
      pathology: 'Diagnostico sensible',
      admissionDate: '2025-01-16',
      isBlocked: false,
    } as DailyRecord['beds'][string];

    await queueSyncTask('UPDATE_DAILY_RECORD', record, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-16T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });
    await processSyncQueue();

    const [operation] = await listRecentSyncQueueOperations(1);
    expect(operation.syncContract).toMatchObject({
      changedPaths: ['beds.R1.pathology'],
    });
    expect(JSON.stringify(operation)).not.toContain('Diagnostico sensible');
    expect(JSON.stringify(operation)).not.toContain('Paciente no debe aparecer');
    expect(JSON.stringify(operation)).not.toContain('44.444.444-4');
  });
});
