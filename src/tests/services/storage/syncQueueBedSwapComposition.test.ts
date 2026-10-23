import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { assertAdmissionDatePersistencePolicy } from '@/services/repositories/dailyRecordAdmissionDateWritePolicy';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';
import { applyDailyRecordClinicalConsistencyCheck } from '@/services/repositories/dailyRecordClinicalConsistencyCheck';
import { evaluateDailyRecordClinicalAuthority } from '@/services/repositories/dailyRecordClinicalAuthorityPolicy';
import {
  createClinicalSyncCensusRecord,
  createClinicalSyncPatient,
} from '@/tests/support/clinicalSyncSimulator/clinicalSyncSimulatorFixtures';

// Combined scenario with synthetic identities: A and a mother (with her newborn in the crib)
// swap occupied beds while another tab still queues an edit made before the swap. The same
// transition goes through every guard a write meets, plus the real queue transport.
const require = createRequire(import.meta.url);
const { findPatientErasures: serverFindPatientErasures } =
  require('../../../../functions/lib/dailyRecordErasureGuard.js') as {
    findPatientErasures: typeof findPatientErasures;
  };

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

const DATE = '2026-07-03';
const BASE_VERSION = '2026-07-03T08:00:00.000Z';
const STALE_EDIT_AT = '2026-07-03T08:30:00.000Z';
const SWAP_VERSION = '2026-07-03T09:00:00.000Z';
const SWAPPED_BEDS = ['beds.R1', 'beds.R2'];

const patientA = (bedId: string) =>
  createClinicalSyncPatient(bedId, {
    patientName: 'Paciente Sintetico A',
    rut: '22.222.222-2',
    clinicalEpisodeId: 'episode-swap-a',
    admissionDate: '2026-06-28',
    firstSeenDate: '2026-06-28',
    pathology: 'Diagnostico A',
  });

const newborn = (rut = '33.333.333-3') =>
  createClinicalSyncPatient('R2', {
    patientName: 'RN Sintetico',
    // The newborn carries the mother's administrative document unless stated otherwise.
    rut,
    clinicalEpisodeId: 'episode-swap-rn',
    admissionDate: '2026-07-02',
    firstSeenDate: '2026-07-02',
    pathology: 'RN sano',
  });

const mother = (bedId: string, crib: DailyRecord['beds'][string] | null = newborn()) =>
  createClinicalSyncPatient(bedId, {
    patientName: 'Madre Sintetica',
    rut: '33.333.333-3',
    clinicalEpisodeId: 'episode-swap-madre',
    admissionDate: '2026-07-01',
    firstSeenDate: '2026-07-01',
    pathology: 'Diagnostico madre',
    ...(crib ? { clinicalCrib: { ...crib, bedId } } : {}),
  });

const beforeSwap = (): DailyRecord =>
  createClinicalSyncCensusRecord({
    date: DATE,
    lastUpdated: BASE_VERSION,
    beds: { R1: patientA('R1'), R2: mother('R2') },
  });

const afterSwap = (motherInR1 = mother('R1')): DailyRecord =>
  createClinicalSyncCensusRecord({
    date: DATE,
    lastUpdated: SWAP_VERSION,
    beds: { R1: motherInR1, R2: patientA('R2') },
  });

const bothErasureGuards = (remote: DailyRecord, local: DailyRecord) => {
  const client = findPatientErasures(remote, local);
  expect(serverFindPatientErasures(remote, local)).toEqual(client);
  return client;
};

const staleDiagnosisTask = (): SyncTask => {
  const local = beforeSwap();
  local.beds.R1 = { ...local.beds.R1, pathology: 'Diagnostico A editado antes del cambio' };
  local.lastUpdated = STALE_EDIT_AT;
  return {
    opId: 'stale-diagnosis-op',
    type: 'UPDATE_DAILY_RECORD',
    payload: local,
    timestamp: 1,
    retryCount: 0,
    status: 'PENDING',
    syncContract: {
      mutationId: 'stale-diagnosis-mutation',
      clientId: 'stale-pc',
      tabId: 'stale-pc-tab-1',
      expectedVersion: BASE_VERSION,
      changedPaths: ['beds.R1.pathology'],
    },
  };
};

const snapshot = (data: unknown) => ({ exists: () => true, data: () => data });
const transaction = () =>
  ({ get: mocks.transactionRead, set: mocks.set }) as unknown as Transaction;
const replay = (task: SyncTask) =>
  createFirestoreSyncTransport({
    getDb: () => ({}) as Firestore,
    ready: Promise.resolve(),
  }).run(task);

const serveRemote = (remote: DailyRecord & { meta?: Record<string, unknown> }) => {
  mocks.read.mockResolvedValue(snapshot(remote));
  mocks.transactionRead.mockResolvedValue(snapshot(remote));
};

describe('bed swap with a mother and her newborn across write guards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (_db, callback) => callback(transaction()));
  });

  it('lets each guard accept the swap as two relocated patient-episodes', () => {
    const before = beforeSwap();
    const after = afterSwap();

    expect(() =>
      assertAdmissionDatePersistencePolicy(DATE, after, before, { changedPaths: SWAPPED_BEDS })
    ).not.toThrow();
    expect(bothErasureGuards(before, after)).toEqual([]);
    expect(
      evaluateDailyRecordClinicalAuthority(after, { date: DATE, phase: 'persistence' }).status
    ).not.toBe('blocked');

    const consistency = applyDailyRecordClinicalConsistencyCheck(after, {
      date: DATE,
      phase: 'persistence',
    });
    expect(consistency.status).not.toBe('blocked');
    expect(consistency.record.beds.R1).toMatchObject({
      clinicalEpisodeId: 'episode-swap-madre',
      admissionDate: '2026-07-01',
      clinicalCrib: { clinicalEpisodeId: 'episode-swap-rn', admissionDate: '2026-07-02' },
    });
    expect(consistency.record.beds.R2).toMatchObject({
      clinicalEpisodeId: 'episode-swap-a',
      admissionDate: '2026-06-28',
    });
  });

  it('still rejects a swap that also rewrites an admission date after the first observed day', () => {
    const after = afterSwap();
    after.beds.R2 = { ...after.beds.R2, admissionDate: '2026-06-30' };

    expect(() =>
      assertAdmissionDatePersistencePolicy(DATE, after, beforeSwap(), {
        changedPaths: SWAPPED_BEDS,
      })
    ).toThrow(AdmissionDatePolicyViolationError);
  });

  it('flags a newborn lost during the swap when it has its own document', () => {
    const before = beforeSwap();
    before.beds.R2 = mother('R2', newborn('44.444.444-4'));

    expect(bothErasureGuards(before, afterSwap(mother('R1', null)))).toEqual([
      { bedId: 'R2 (cuna RN)', remotePatientName: 'RN Sintetico' },
    ]);
  });

  it('flags the lost newborn even when it shares the mother document', () => {
    expect(bothErasureGuards(beforeSwap(), afterSwap(mother('R1', null)))).toEqual([
      { bedId: 'R2 (cuna RN)', remotePatientName: 'RN Sintetico' },
    ]);
  });

  it('rejects a stale queued edit whose path the authority stamped for the swap', async () => {
    serveRemote({
      ...afterSwap(),
      meta: { lastMutationId: 'swap-mutation', lastChangedPaths: SWAPPED_BEDS },
    });

    const rejection = replay(staleDiagnosisTask());
    await expect(rejection).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(rejection).rejects.toThrow(/same changed path/);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  const expectStaleEditDropped = async () => {
    const outcome = await replay(staleDiagnosisTask());

    expect(mocks.set).toHaveBeenCalledOnce();
    const written = mocks.set.mock.calls[0][1] as DailyRecord;
    expect(mocks.set.mock.calls[0][2]).toEqual({ merge: true });
    expect(written.beds.R1).toMatchObject({
      patientName: 'Madre Sintetica',
      clinicalEpisodeId: 'episode-swap-madre',
      pathology: 'Diagnostico madre',
      clinicalCrib: { patientName: 'RN Sintetico', clinicalEpisodeId: 'episode-swap-rn' },
    });
    // The edit does not follow the moved patient either. On success the queue engine deletes the
    // task and adopts this record (`completeClaimedSyncTask`), so no conflict is ever raised.
    expect(written.beds.R2).toMatchObject({
      patientName: 'Paciente Sintetico A',
      clinicalEpisodeId: 'episode-swap-a',
      pathology: 'Diagnostico A',
      admissionDate: '2026-06-28',
    });
    expect(outcome).toMatchObject({ authoritativeRecord: { beds: { R2: written.beds.R2 } } });
  };

  it('known limit: direct publish drops the stale edit instead of moving or blocking it', async () => {
    // Client direct writes leave no `meta.lastChangedPaths`, so the queue merges by episode.
    serveRemote(afterSwap());

    await expectStaleEditDropped();
  });

  it('known limit: a full-save stamp does not block the stale edit', async () => {
    // Full saves declare `changedPaths: ['*']`; the same-path check compares it literally.
    serveRemote({ ...afterSwap(), meta: { lastMutationId: 'full-save', lastChangedPaths: ['*'] } });

    await expectStaleEditDropped();
  });
});
