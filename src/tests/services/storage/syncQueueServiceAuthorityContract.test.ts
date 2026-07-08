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
    getRecordDocRef: vi.fn(() => ({ id: 'sync-test-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

vi.mock('@/services/utils/errorService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/utils/errorService')>();
  return {
    ...actual,
    logError: vi.fn(),
  };
});

import { getDoc, setDoc } from 'firebase/firestore';
import { processSyncQueue, queueSyncTask } from '@/services/storage/sync';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus } from '@/types/domain/patientClassification';

describe('storage/sync authority contract', () => {
  const makeRecord = (date: string, marker: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: marker,
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
    vi.mocked(setDoc).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('keeps client and tab identity stable while assigning a new mutation id per replaced queued edit', async () => {
    await queueSyncTask(
      'UPDATE_DAILY_RECORD',
      makeRecord('2025-01-17', '2025-01-17T10:00:00.000Z')
    );

    const [firstTask] = await hospitalDB.syncQueue.toArray();
    const firstContract = firstTask.syncContract;

    await queueSyncTask(
      'UPDATE_DAILY_RECORD',
      makeRecord('2025-01-17', '2025-01-17T10:01:00.000Z')
    );

    const [reusedTask] = await hospitalDB.syncQueue.toArray();
    expect(reusedTask.syncContract?.clientId).toBe(firstContract?.clientId);
    expect(reusedTask.syncContract?.tabId).toBe(firstContract?.tabId);
    expect(reusedTask.syncContract?.mutationId).toEqual(expect.stringMatching(/^mutation_/));
    expect(reusedTask.syncContract?.mutationId).not.toBe(firstContract?.mutationId);
    expect((reusedTask.payload as DailyRecord).lastUpdated).toBe('2025-01-17T10:01:00.000Z');
  });

  it('revalidates expected-version drift even when another browser wrote within 30 seconds', async () => {
    const local = makeRecord('2025-01-16', '2025-01-16T10:00:10.000Z');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Sync',
      rut: '11.111.111-1',
      age: '40a',
      pathology: 'Diagnostico local nuevo',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-16',
      admissionTime: '08:00',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];

    const remote = makeRecord('2025-01-16', '2025-01-16T10:00:05.000Z');
    remote.beds.R1 = {
      ...local.beds.R1,
      pathology: 'Diagnostico base remoto',
      status: PatientStatus.GRAVE,
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-16T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).toHaveBeenCalledTimes(1);
    const writtenRecord = vi.mocked(setDoc).mock.calls[0][1] as DailyRecord;
    expect(writtenRecord.beds.R1.pathology).toBe('Diagnostico local nuevo');
    expect(writtenRecord.beds.R1.status).toBe('Grave');
    expect(writtenRecord.lastUpdated).toBe('2025-01-16T10:00:10.000Z');
  });
});
