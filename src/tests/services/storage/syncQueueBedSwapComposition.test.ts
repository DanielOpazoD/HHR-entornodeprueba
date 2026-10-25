import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
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

  // The stale edit was written for A, who left R1. It reaches neither the mother now in R1 nor
  // A in R2: the transport detaches it as a conflict bound to A, and the queue store writes that
  // conflict in the same transaction that completes the task (`completeClaimedSyncTask`).
  const expectStaleEditHeldForA = async () => {
    const outcome = await replay(staleDiagnosisTask());

    expect(mocks.set).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      authoritativeRecord: {
        beds: {
          R1: { patientName: 'Madre Sintetica', pathology: 'Diagnostico madre' },
          R2: { patientName: 'Paciente Sintetico A', pathology: 'Diagnostico A' },
        },
      },
      detachedConflicts: [
        {
          status: 'CONFLICT',
          lastErrorCode: 'occupant_changed',
          error: expect.stringContaining('La cama R1 ya no tiene a Paciente Sintetico A'),
          syncContract: { changedPaths: ['beds.R1.pathology'] },
          payload: {
            beds: {
              R1: {
                patientName: 'Paciente Sintetico A',
                clinicalEpisodeId: 'episode-swap-a',
                pathology: 'Diagnostico A editado antes del cambio',
              },
            },
          },
        },
      ],
    });
  };

  it('holds a stale queued edit as a conflict for A when the authority stamped the swap', async () => {
    serveRemote({
      ...afterSwap(),
      meta: { lastMutationId: 'swap-mutation', lastChangedPaths: SWAPPED_BEDS },
    });

    await expectStaleEditHeldForA();
  });

  it('holds the stale edit as a conflict for A after a direct publish', async () => {
    // Client direct writes leave no `meta.lastChangedPaths`; the edit used to be dropped here.
    serveRemote(afterSwap());

    await expectStaleEditHeldForA();
  });

  it('holds the stale edit as a conflict for A after a full-save stamp', async () => {
    // Full saves declare `changedPaths: ['*']`; the edit used to be dropped here too.
    serveRemote({ ...afterSwap(), meta: { lastMutationId: 'full-save', lastChangedPaths: ['*'] } });

    await expectStaleEditHeldForA();
  });
});
