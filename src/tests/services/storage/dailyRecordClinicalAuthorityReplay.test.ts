// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import {
  createClinicalSyncCensusRecord,
  createClinicalSyncPatient,
} from '@/tests/support/clinicalSyncSimulator/clinicalSyncSimulatorFixtures';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  set: vi.fn(),
  transactionRead: vi.fn(),
  saveCallable: vi.fn(),
}));

vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: mocks.read,
  runTransaction: mocks.transaction,
}));

vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-authority-replay' }),
}));

vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: mocks.saveCallable,
}));

const DATE = '2026-05-13';
const BASE_VERSION = '2026-05-13T08:00:00.000Z';

const makeTask = (record: DailyRecord, opId: string): SyncTask => ({
  opId,
  type: 'UPDATE_DAILY_RECORD',
  payload: record,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  syncContract: {
    mutationId: `${opId}-mutation`,
    clientId: 'synthetic-pc',
    tabId: 'synthetic-pc-tab-1',
    expectedVersion: BASE_VERSION,
    changedPaths: ['*'],
  },
});

const replay = (task: SyncTask) =>
  createFirestoreSyncTransport({
    getDb: () => ({}) as Firestore,
    ready: Promise.resolve(),
  }).run(task);

describe('sync queue replay respects unified clinical authority rules (ID-01)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.read.mockResolvedValue({ exists: () => false, data: () => undefined });
    mocks.transactionRead.mockResolvedValue({ exists: () => false, data: () => undefined });
    mocks.transaction.mockImplementation(async (_db, callback) =>
      callback({ get: mocks.transactionRead, set: mocks.set } as unknown as Transaction)
    );
    mocks.saveCallable.mockImplementation(async ({ record }: { record: DailyRecord }) => {
      const committedLastUpdated = '2026-05-13T09:00:00.000Z';
      return {
        date: record.date,
        lastUpdated: committedLastUpdated,
        recordState: {
          lastUpdated: committedLastUpdated,
          record: { ...record, lastUpdated: committedLastUpdated },
        },
      };
    });
  });

  it('replays a record with two distinct undocumented patients sharing admission date and time', async () => {
    const record = createClinicalSyncCensusRecord({
      date: DATE,
      lastUpdated: BASE_VERSION,
      beds: {
        R1: createClinicalSyncPatient('R1', {
          patientName: 'Paciente Sintetico A',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: DATE,
          admissionTime: '08:00',
        }),
        R2: createClinicalSyncPatient('R2', {
          patientName: 'Paciente Sintetico B',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: DATE,
          admissionTime: '08:00',
        }),
      },
    });

    await expect(replay(makeTask(record, 'allow-distinct-no-rut'))).resolves.toBeDefined();
    expect(mocks.saveCallable).toHaveBeenCalledTimes(1);
  });

  it('blocks replay when an active bed and discharge share normalized name and admission context without document or episode id', async () => {
    const patient = createClinicalSyncPatient('R1', {
      patientName: 'Paciente Sintetico Cerrado',
      rut: '',
      clinicalEpisodeId: undefined,
      admissionDate: DATE,
      admissionTime: '08:00',
    });
    const record = createClinicalSyncCensusRecord({
      date: DATE,
      lastUpdated: BASE_VERSION,
      beds: { R1: patient },
      discharges: [
        {
          id: 'discharge-closed-no-rut',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'paciente sintetico cerrado',
          rut: '',
          diagnosis: 'Diagnostico',
          admissionDate: DATE,
          time: '11:00',
          status: 'Vivo',
          originalData: patient,
        },
      ],
    });

    await expect(replay(makeTask(record, 'block-closed-no-rut'))).rejects.toThrow(ConcurrencyError);
    expect(mocks.saveCallable).not.toHaveBeenCalled();
  });
});
