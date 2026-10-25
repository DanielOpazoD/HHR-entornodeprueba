import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase/firestore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  set: vi.fn(),
  transactionRead: vi.fn(),
  callable: vi.fn(),
  mode: 'client_only',
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: mocks.read,
  runTransaction: mocks.transaction,
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-record' }),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => mocks.mode,
  isServerClinicalWriteFenceActive: async () => false,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: mocks.callable,
}));

type Json = Record<string, unknown>;

const STORED_AT = `${DATE}T08:00:00.000Z`;
const snapshot = (data: unknown) => ({ exists: () => true, data: () => data });
const missing = () => ({ exists: () => false });

/** The nurse's queued edit: the day as her device read it, plus her change. */
const queuedEdit = (edit: (record: DailyRecord) => void, lastUpdated = STORED_AT) => {
  const record = docToRecord(storedDay(), DATE);
  edit(record);
  return { ...record, lastUpdated };
};

const task = (payload: DailyRecord, changedPaths: string[], expectedVersion: string): SyncTask => ({
  opId: 'synthetic-op',
  type: 'UPDATE_DAILY_RECORD',
  payload,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  syncContract: { expectedVersion, changedPaths, mutationId: 'synthetic-mutation' },
});

const run = (input: SyncTask) =>
  createFirestoreSyncTransport({ getDb: () => ({}) as Firestore, ready: Promise.resolve() }).run(
    input
  );

/** The day the replay sent to Firestore, by whichever route this authority mode uses. */
const writtenDay = (): Json =>
  mocks.mode === 'enforced' ? mocks.callable.mock.calls[0][0].record : mocks.set.mock.calls[0][1];

const expectR1AsStored = (written: Json) => {
  const r1 = (written.beds as Record<string, Json>).R1;
  expect(r1.documentType).toBe('Cedula');
  expect(r1.patientName).toBe('PACIENTE UNO');
  expect(r1.rut).toBe('FAKE-PASSPORT-R1');
  expect(JSON.stringify(written)).not.toContain('identityReview');
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(snapshot(storedDay()));
  mocks.transactionRead.mockResolvedValue(snapshot(storedDay()));
  mocks.transaction.mockImplementation(async (_db, callback) =>
    callback({ get: mocks.transactionRead, set: mocks.set } as unknown as Transaction)
  );
  mocks.callable.mockImplementation(async ({ record }) => ({
    recordState: { record, lastUpdated: record.lastUpdated },
  }));
});

describe.each(['client_only', 'enforced'])('replay of a queued edit (%s)', mode => {
  beforeEach(() => {
    mocks.mode = mode;
  });

  it('publishes an edit of another bed and writes R1 back exactly as stored', async () => {
    const payload = queuedEdit(record => {
      record.beds.R2.pathology = 'DIAGNOSTICO EDITADO';
    });

    await expect(run(task(payload, ['beds.R2.pathology'], STORED_AT))).resolves.toBeTruthy();

    const written = writtenDay();
    expectR1AsStored(written);
    expect((written.beds as Record<string, Json>).R2.pathology).toBe('DIAGNOSTICO EDITADO');
  });

  it('merges onto a newer stored day without overwriting the unreadable identity', async () => {
    const newer = storedDay(undefined, { lastUpdated: `${DATE}T08:30:00.000Z` });
    mocks.read.mockResolvedValue(snapshot(newer));
    mocks.transactionRead.mockResolvedValue(snapshot(newer));
    const payload = queuedEdit(record => {
      record.beds.R1.pathology = 'DIAGNOSTICO R1 EDITADO';
    });

    await expect(run(task(payload, ['beds.R1.pathology'], STORED_AT))).resolves.toBeTruthy();

    const written = writtenDay();
    expectR1AsStored(written);
    expect((written.beds as Record<string, Json>).R1.pathology).toBe('DIAGNOSTICO R1 EDITADO');
  });

  it('publishes the nurse repair of the document type', async () => {
    const newer = storedDay(undefined, { lastUpdated: `${DATE}T08:30:00.000Z` });
    mocks.read.mockResolvedValue(snapshot(newer));
    mocks.transactionRead.mockResolvedValue(snapshot(newer));
    // The repair is a field edit: the queued day is the one its patch prepared.
    const payload = {
      ...preparePatchedRecordPersistence(docToRecord(storedDay(), DATE), DATE, {
        'beds.R1.documentType': 'Pasaporte',
      }).record,
      lastUpdated: STORED_AT,
    };

    const outcome = await run(task(payload, ['beds.R1.documentType'], STORED_AT));

    expect((writtenDay().beds as Record<string, Json>).R1.documentType).toBe('Pasaporte');
    expect(JSON.stringify(writtenDay())).not.toContain('identityReview');
    // The device adopts the repaired bed, not the review the stored day still held.
    const adopted = (outcome as { authoritativeRecord: DailyRecord }).authoritativeRecord;
    expect(adopted.beds.R1.documentType).toBe('Pasaporte');
    expect(adopted.beds.R1.identityReview).toBeUndefined();
  });

  it('recreates a day that is gone with R1 exactly as stored', async () => {
    mocks.read.mockResolvedValue(missing());
    mocks.transactionRead.mockResolvedValue(missing());
    const payload = queuedEdit(record => {
      record.beds.R2.pathology = 'DIAGNOSTICO EDITADO';
    });

    await run(task(payload, ['beds.R2.pathology'], STORED_AT));

    expectR1AsStored(writtenDay());
    expect((writtenDay().beds as Record<string, Json>).R2.pathology).toBe('DIAGNOSTICO EDITADO');
  });

  it('writes nothing about a review once the stored day was repaired elsewhere', async () => {
    const repaired = storedDay(
      { documentType: 'Pasaporte' },
      { lastUpdated: `${DATE}T08:30:00.000Z` }
    );
    mocks.read.mockResolvedValue(snapshot(repaired));
    mocks.transactionRead.mockResolvedValue(snapshot(repaired));
    const payload = queuedEdit(record => {
      record.beds.R2.pathology = 'DIAGNOSTICO EDITADO';
    });

    await run(task(payload, ['beds.R2.pathology'], STORED_AT));

    const written = writtenDay();
    expect((written.beds as Record<string, Json>).R1.documentType).toBe('Pasaporte');
    expect(JSON.stringify(written)).not.toContain('identityReview');
  });

  it('refuses a queued day whose movement snapshot copied the reviewed patient', async () => {
    const payload = queuedEdit(record => {
      record.discharges = [
        DataFactory.createMockDischarge({ id: 'discharge-r1', originalData: record.beds.R1 }),
      ];
    });

    const error = await run(task(payload, ['discharges'], STORED_AT)).catch(caught => caught);

    expect(error).toMatchObject({ code: 'patient_identity_repair_required', bedId: 'R1' });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.callable).not.toHaveBeenCalled();
  });
});

it('hands the device cache the authority answer with R1 under review, not its raw value', async () => {
  mocks.mode = 'enforced';
  const payload = queuedEdit(record => {
    record.beds.R2.pathology = 'DIAGNOSTICO EDITADO';
  });

  const outcome = await run(task(payload, ['beds.R2.pathology'], STORED_AT));
  const adopted = (outcome as { authoritativeRecord: DailyRecord }).authoritativeRecord;

  expect(adopted.beds.R1.identityReview).toEqual({
    bedId: 'R1',
    slot: 'bed',
    fields: ['documentType'],
    stored: { documentType: 'Cedula' },
  });
  expect(adopted.beds.R1.documentType).toBeUndefined();
  expect(adopted.beds.R2.pathology).toBe('DIAGNOSTICO EDITADO');
});
