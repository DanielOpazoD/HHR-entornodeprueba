import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  getDocFromServer,
  type DocumentReference,
  type Firestore,
  type Transaction,
  type UpdateData,
  type DocumentData,
} from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

const race = vi.hoisted(() => ({
  db: null as Firestore | null,
  secondDb: null as Firestore | null,
  armed: false,
  reads: 0,
  bothRead: () => {},
  firstRead: () => {},
  release: Promise.resolve(),
  firstCommitted: Promise.resolve(),
  commitFirst: () => {},
}));
vi.mock('@/firebaseConfig', () => ({ db: null, auth: null }));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: {
    getDb: () => {
      if (!race.db) throw new Error('Synthetic Firestore not initialized');
      return race.db;
    },
    ready: Promise.resolve(),
  },
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'enforced',
  isServerClinicalWriteFenceActive: async () => true,
}));
vi.mock('firebase/firestore', async original => {
  const sdk = await original<typeof import('firebase/firestore')>();
  const afterRead = async (ref: DocumentReference) => {
    if (!race.armed) return;
    race.reads += 1;
    if (race.reads === 1) race.firstRead();
    if (race.reads === 2) race.bothRead();
    await race.release;
    if (ref.firestore === race.secondDb) await race.firstCommitted;
  };
  return {
    ...sdk,
    getDoc: async (ref: DocumentReference) => {
      const snapshot = await sdk.getDoc(ref);
      await afterRead(ref);
      return snapshot;
    },
    updateDoc: async (ref: DocumentReference, patch: UpdateData<DocumentData>) => {
      await sdk.updateDoc(ref, patch);
      if (race.armed && ref.firestore !== race.secondDb) race.commitFirst();
    },
    runTransaction: (db: Firestore, update: (tx: Transaction) => Promise<unknown>) =>
      sdk
        .runTransaction(db, tx =>
          update(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'get')
                  return async (ref: DocumentReference) => {
                    const snapshot = await target.get(ref);
                    await afterRead(ref);
                    return snapshot;
                  };
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            })
          )
        )
        .then(result => {
          if (race.armed && db !== race.secondDb) race.commitFirst();
          return result;
        }),
  };
});

import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordDocRef, docToRecord } from '@/services/storage/firestore/firestoreShared';
import {
  buildDetailedStaffingPatch,
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
const date = '2026-10-27';
const base = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T10:00:00.000Z`,
    nursesDayShift: ['SYNTHETIC BASE NURSE'],
    tensDayShift: ['SYNTHETIC BASE TENS'],
  });
let environment: RulesTestEnvironment;
beforeAll(async () => {
  if (!enabled) return;
  const { host, port } = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
  expect(['127.0.0.1', 'localhost']).toContain(host);
  environment = await initializeTestEnvironment({
    projectId: 'demo-hhr-staffing-atomic',
    firestore: { host, port, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
  });
  await environment.clearFirestore();
});
afterAll(async () => {
  if (environment) await environment.cleanup();
});

it.skipIf(!enabled)(
  'preserves concurrent staffing and accepts the second edit only after a fresh base',
  async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(base());
    });
    const first = environment
      .authenticatedContext('synthetic-staff-a', { role: 'admin' })
      .firestore() as unknown as Firestore;
    const second = environment
      .authenticatedContext('synthetic-staff-b', { role: 'admin' })
      .firestore() as unknown as Firestore;
    const firstRef = getRecordDocRef(date, { getDb: () => first, ready: Promise.resolve() });
    race.secondDb = getRecordDocRef(date, {
      getDb: () => second,
      ready: Promise.resolve(),
    }).firestore;
    let release = () => {};
    const firstRead = new Promise<void>(resolve => {
      race.firstRead = resolve;
    });
    const bothRead = new Promise<void>(resolve => {
      race.bothRead = resolve;
    });
    race.release = new Promise<void>(resolve => {
      release = resolve;
    });
    race.firstCommitted = new Promise<void>(resolve => {
      race.commitFirst = resolve;
    });
    race.reads = 0;
    race.armed = true;
    const patch = (role: 'nurse' | 'tens', name: string, record = base()) =>
      buildDetailedStaffingPatch(
        updateDetailedStaffingStandardSlot(
          resolveDetailedStaffingState(record, date),
          'day',
          role,
          0,
          name
        )
      );
    race.db = first;
    const a = updateRecordPartial(date, patch('nurse', 'SYNTHETIC A'), base().lastUpdated, {
      historyPolicy: 'skip',
    });
    await firstRead;
    race.db = second;
    const b = updateRecordPartial(date, patch('tens', 'SYNTHETIC B'), base().lastUpdated, {
      historyPolicy: 'skip',
    });
    const resultsPromise = Promise.allSettled([a, b]);
    await bothRead;
    release();
    const results = await resultsPromise;
    race.armed = false;
    expect(race.reads).toBeGreaterThanOrEqual(2);
    const stored = await getDocFromServer(firstRef);
    if (!stored.exists()) throw new Error('Missing synthetic census after concurrent writes');
    expect(stored.data()?.nursesDayShift).toContain('SYNTHETIC A');
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { name: 'ConcurrencyError' } });
    const fresh = docToRecord(stored.data(), date);
    race.db = second;
    await updateRecordPartial(date, patch('tens', 'SYNTHETIC B', fresh), fresh.lastUpdated, {
      historyPolicy: 'skip',
    });
    const final = await getDocFromServer(firstRef);
    expect(final.data()?.nursesDayShift).toContain('SYNTHETIC A');
    expect(final.data()?.tensDayShift).toContain('SYNTHETIC B');
  }
);
