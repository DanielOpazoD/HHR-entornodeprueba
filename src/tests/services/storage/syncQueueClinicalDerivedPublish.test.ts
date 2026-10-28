/**
 * Direct publish of a queued day (merge: true) on split days (D9 and the create rule of
 * DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): the write keeps the stored marker, meta and
 * moved fields, and a create never carries a marker (the rule would deny the entry forever and
 * queues are never purged). Unmarked days publish exactly as before. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteField, type Firestore, type Transaction } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  set: vi.fn(),
  transactionRead: vi.fn(),
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
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
  isServerClinicalWriteFenceActive: async () => false,
}));

type Holder = Record<string, unknown>;

const date = '2026-11-02';
const marker = { version: 1, generation: 'gen_synthetic_a' };
const moved = (label: string) => ({
  clinicalSyncCheckpoint: {
    version: 3,
    fingerprintVersion: 1,
    sources: { vitals: { watermark: label } },
  },
  vitalSignsHistory: [
    { recordedDate: date, recordedAt: `${date}T08:00:00`, heartRate: 80, author: label },
  ],
});
const patient = (bedId: string, clinicalEpisodeId: string, extra: Holder = {}) =>
  DataFactory.createMockPatient(bedId, {
    patientName: `Paciente sintético ${clinicalEpisodeId}`,
    rut: bedId === 'R1' ? '11.111.111-1' : '22.222.222-2',
    clinicalEpisodeId,
    ...extra,
  } as Partial<PatientData>);
const day = (lastUpdated: string, beds: Record<string, PatientData>, extra: Holder = {}) =>
  ({
    ...DataFactory.createMockDailyRecord(date, { lastUpdated }),
    beds,
    ...extra,
  }) as DailyRecord;

// Stored split day: ep_a lives in its document, ep_b is not split yet (embedded copy only).
const splitStored = (lastUpdated: string) =>
  day(
    lastUpdated,
    { R1: patient('R1', 'ep_a'), R2: patient('R2', 'ep_b', moved('stored-b')) },
    { clinicalDerivedLayout: marker, meta: { revision: 8 } }
  );
// Queued local copy taken before the split, still embedding every moved field.
const preSplitLocal = () =>
  day(
    `${date}T10:00:00.000Z`,
    { R1: patient('R1', 'ep_a', moved('local-a')), R2: patient('R2', 'ep_b', moved('local-b')) },
    { meta: { revision: 3 } }
  );

const missing = () => ({ exists: () => false });
const snapshot = (data: unknown) => ({ exists: () => true, data: () => data });
const tx = () => ({ get: mocks.transactionRead, set: mocks.set }) as unknown as Transaction;
const task = (payload: DailyRecord, syncContract?: SyncTask['syncContract']): SyncTask => ({
  opId: 'synthetic-op',
  type: 'UPDATE_DAILY_RECORD',
  payload,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  ...(syncContract ? { syncContract } : {}),
});
const run = (input: SyncTask) =>
  createFirestoreSyncTransport({ getDb: () => ({}) as Firestore, ready: Promise.resolve() }).run(
    input
  );
const written = () => mocks.set.mock.calls[0][1] as Holder & { beds: Record<string, Holder> };
// Firestore set-merge: nested maps merge key by key and deleteField() removes the stored key.
const DELETE = deleteField();
const isMap = (value: unknown): value is Holder =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const applyMerge = (stored: Holder, payload: Holder): Holder => {
  const result: Holder = { ...stored };
  Object.entries(payload).forEach(([key, value]) => {
    if (DELETE.isEqual(value as typeof DELETE)) delete result[key];
    else if (isMap(value) && !('isEqual' in value)) {
      result[key] = applyMerge(isMap(result[key]) ? result[key] : {}, value);
    } else result[key] = value;
  });
  return result;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(missing());
  mocks.transactionRead.mockResolvedValue(missing());
  mocks.transaction.mockImplementation(async (_db, callback) => callback(tx()));
});

describe('queue publish to a split day', () => {
  it('drops the local moved fields for a full save against its current base', async () => {
    const storedAt = `${date}T09:00:00.000Z`;
    mocks.read.mockResolvedValue(snapshot(splitStored(storedAt)));
    mocks.transactionRead.mockResolvedValue(snapshot(splitStored(storedAt)));

    const outcome = await run(task(preSplitLocal(), { expectedVersion: storedAt }));

    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.set.mock.calls[0][2]).toEqual({ merge: true });
    const payload = written();
    expect(payload.clinicalDerivedLayout).toEqual(marker);
    expect(payload.meta).toEqual({ revision: 8 });
    // The split episode carries nothing, so merge: true never writes an embedded copy back.
    expect('vitalSignsHistory' in payload.beds.R1).toBe(false);
    expect('clinicalSyncCheckpoint' in payload.beds.R1).toBe(false);
    // The unsplit episode keeps its stored copy, never the local one.
    expect(payload.beds.R2).toMatchObject(moved('stored-b'));
    expect(outcome).toMatchObject({
      authoritativeRecord: { clinicalDerivedLayout: marker, meta: { revision: 8 } },
    });
  });

  it('refuses an opaque replay against a newer split day without writing', async () => {
    const stored = splitStored(`${date}T09:30:00.000Z`);
    mocks.read.mockResolvedValue(snapshot(stored));
    mocks.transactionRead.mockResolvedValue(snapshot(stored));
    const queued = task(preSplitLocal(), {
      expectedVersion: `${date}T09:00:00.000Z`,
      changedPaths: ['*'],
    });
    const original = structuredClone(queued);

    await expect(run(queued)).rejects.toMatchObject({
      name: 'ConcurrencyError',
      reason: 'semantic_conflict',
    });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(queued).toEqual(original);
  });

  it('leaves no other episode’s embedded copy under a bed’s new occupant (merge: true)', async () => {
    // Stored: ep_c (not split yet) in R2. Queued: ep_new took R2, ep_c moved to R4.
    const stored = day(
      `${date}T09:00:00.000Z`,
      { R2: patient('R2', 'ep_c', moved('stored-c')) },
      { clinicalDerivedLayout: marker, meta: { revision: 8 } }
    );
    mocks.read.mockResolvedValue(snapshot(stored));
    mocks.transactionRead.mockResolvedValue(snapshot(stored));
    const local = day(`${date}T10:00:00.000Z`, {
      R2: patient('R2', 'ep_new', moved('local-new')),
      R4: patient('R4', 'ep_c', moved('local-c')),
    });

    await run(task(local, { expectedVersion: stored.lastUpdated }));

    const merged = applyMerge(sanitizeForFirestore(stored) as Holder, written()) as {
      beds: Record<string, Holder>;
    };
    expect(merged.beds.R2).toMatchObject({ clinicalEpisodeId: 'ep_new' });
    expect(merged.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(merged.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(merged.beds.R4).toMatchObject(moved('stored-c'));
  });

  it('never creates a day with a marker, even from a marked local copy', async () => {
    const local = { ...preSplitLocal(), clinicalDerivedLayout: marker } as DailyRecord;

    const outcome = (await run(task(local))) as { authoritativeRecord: DailyRecord };

    expect('clinicalDerivedLayout' in written()).toBe(false);
    // A recreated day is unmarked, so its moved fields stay embedded as today.
    expect(written().beds.R1).toMatchObject(moved('local-a'));
    expect('clinicalDerivedLayout' in outcome.authoritativeRecord).toBe(false);
  });
});

describe('queue publish to an unmarked day', () => {
  it.each([
    [
      'an existing day',
      () => snapshot(day(`${date}T09:00:00.000Z`, {}, { meta: { revision: 9 } })),
    ],
    ['a new day', missing],
  ])('writes the queued record unchanged for %s', async (_label, stored) => {
    mocks.read.mockResolvedValue(stored());
    mocks.transactionRead.mockResolvedValue(stored());
    const queued = task(preSplitLocal(), { expectedVersion: `${date}T09:00:00.000Z` });

    const outcome = await run(queued);

    expect(written()).toEqual(sanitizeForFirestore(queued.payload));
    expect(outcome).toEqual({ authoritativeRecord: queued.payload });
    expect((outcome as { authoritativeRecord: unknown }).authoritativeRecord).toBe(queued.payload);
  });
});
