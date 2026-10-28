import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, type Firestore, type Transaction } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';

vi.mock('@/firebaseConfig', () => ({ db: null, auth: null }));

const interleave = vi.hoisted(() => ({ afterRead: async () => {}, attempts: 0 }));
vi.mock('firebase/firestore', async original => {
  const actual = await original<typeof import('firebase/firestore')>();
  return {
    ...actual,
    runTransaction: (db: Firestore, update: (tx: Transaction) => Promise<unknown>) =>
      actual.runTransaction(db, transaction => {
        interleave.attempts += 1;
        return update(
          new Proxy(transaction, {
            get(target, key) {
              if (key === 'get')
                return async (...args: Parameters<Transaction['get']>) => {
                  const snapshot = await target.get(...args);
                  await interleave.afterRead();
                  return snapshot;
                };
              const value = Reflect.get(target, key);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          })
        );
      }),
  };
});
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
  isServerClinicalWriteFenceActive: async () => false,
}));

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
let environment: RulesTestEnvironment;
const date = '2026-07-17';
const record = (hour: string) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T${hour}:00:00.000Z`,
  });
beforeAll(async () => {
  if (!enabled) return;
  const { host, port } = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
  environment = await initializeTestEnvironment({
    projectId: 'demo-hhr-sync-atomic',
    firestore: { host, port, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
  });
  await environment.clearFirestore();
});
afterAll(async () => {
  if (environment) await environment.cleanup();
});

it.skipIf(!enabled)(
  'retries the real transaction and preserves a concurrent writer instead of publishing stale intent',
  async () => {
    const path = `hospitals/hanga_roa/dailyRecords/${date}`;
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(path).set(record('09'));
    });
    const db = environment.authenticatedContext('synthetic-admin', { role: 'admin' }).firestore();
    const runtime = { getDb: () => db as unknown as Firestore, ready: Promise.resolve() };
    let intervened = false;
    interleave.attempts = 0;
    interleave.afterRead = async () => {
      if (intervened) return;
      intervened = true;
      await environment.withSecurityRulesDisabled(async context => {
        await context.firestore().doc(path).set(record('11'));
      });
    };
    await expect(
      createFirestoreSyncTransport(runtime).run({
        opId: 'synthetic-atomic-op',
        type: 'UPDATE_DAILY_RECORD',
        payload: record('10'),
        timestamp: 1,
        retryCount: 0,
        status: 'PENDING',
        syncContract: { changedPaths: ['*'], expectedVersion: record('09').lastUpdated },
      })
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(intervened).toBe(true);
    expect(interleave.attempts).toBeGreaterThanOrEqual(2);
    const persisted = await getDoc(getRecordDocRef(date, runtime));
    expect(persisted.data()?.lastUpdated).toBe(record('11').lastUpdated);
  }
);
