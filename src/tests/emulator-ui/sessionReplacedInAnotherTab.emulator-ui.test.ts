import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataFactory } from '@/tests/factories/DataFactory';
import { readDailyRecordQuery } from '@/tests/utils/readDailyRecordQuery';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import {
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';
import { reconcileAuthorizedSessionOwner } from '@/services/storage/sessionScopedStorageService';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionOwner } from '@/services/storage/sessionStorageTransition';
import { getTodayISO } from '@/utils/dateCoreUtils';

let activeDb: unknown;
vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: {
    currentUser: { uid: 'synthetic-tab-a', email: 'hospitalizados@hospitalhangaroa.cl' },
  },
  storage: {},
  functions: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  getFunctionsInstance: vi.fn().mockResolvedValue({}),
  firebaseReady: Promise.resolve(),
  mountConfigWarning: vi.fn(),
}));

const host = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = host ? describe : describe.skip;
const date = getTodayISO();
const recordPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const a = 'user:synthetic-tab-a';
const b = 'user:synthetic-tab-b';

// B signs in in another tab while this tab still has A admitted. Once B holds the shared browser,
// stale tab A stops reading, receiving updates, or creating days in B's shared storage.
describeEmulator('this tab stops acting for A after B signs in in another tab', () => {
  let environment: RulesTestEnvironment;
  const cleanups: Array<() => void> = [];

  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host ?? '');
    if (!endpoint) throw new Error('Use the canonical loopback Firestore emulator launcher.');
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-session-other-tab',
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  }, 90_000);

  beforeEach(async () => {
    await environment.clearFirestore();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    resetDailyRecordFreshnessGateForTests();
    setFirestoreEnabled(true);
    activeDb = environment
      .authenticatedContext('synthetic-tab-a', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });

  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    resetDailyRecordFreshnessGateForTests();
    clearSyntheticSession();
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  const seedRecord = async () => {
    const record = DataFactory.createMockDailyRecord(date, {
      beds: {},
      nursesDayShift: ['Synthetic nurse A', 'Synthetic nurse B'],
    });
    await environment.withSecurityRulesDisabled(context =>
      context.firestore().doc(recordPath).set(record)
    );
    return record;
  };

  const updateShift = (shift: string[]) =>
    environment.withSecurityRulesDisabled(context =>
      context
        .firestore()
        .doc(recordPath)
        .update({ nursesDayShift: shift, lastUpdated: new Date().toISOString() })
    );

  const watchRecord = () => {
    const client = new QueryClient();
    const stop = createDailyRecordSubscription(
      { getForDateWithMeta, subscribeDetailed },
      date,
      client
    );
    cleanups.push(() => {
      stop?.();
      client.clear();
    });
    return () => client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date));
  };

  const admitAThenReplaceWithB = () => {
    admitSyntheticSession(a, 'generation-a');
    replaceStoredSessionOwner(b);
    expect(getSessionOwner()).toBe(a);
  };

  it('a subscription A opens afterwards neither delivers nor caches shared server updates', async () => {
    admitAThenReplaceWithB();
    await seedRecord();
    const read = watchRecord();
    await updateShift(['SYNTHETIC UPDATE HIDDEN FROM STALE TAB A']);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(read()).toBeUndefined();
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });

  it('a point read A starts afterwards is refused without touching IndexedDB', async () => {
    admitAThenReplaceWithB();
    await seedRecord();
    await expect(readDailyRecordQuery({ getForDateWithMeta }, date)).rejects.toThrow();
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });

  it('a day A attempts to create offline afterwards is rejected without mutating storage or queue', async () => {
    admitAThenReplaceWithB();
    setFirestoreEnabled(false);
    await expect(initializeDay(date)).rejects.toThrow('La sesión cambió');
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  });

  // Last: it loads a second copy of the session modules, as another tab would have.
  it('after a real sign-in of B in another tab, stale tab A stands down instead of reading B’s day', async () => {
    await reconcileAuthorizedSessionOwner(a);
    vi.resetModules();
    const otherTab = await import('@/services/storage/sessionScopedStorageService');
    const otherTabSession = await import('@/services/storage/sessionStorageTransition');
    await otherTab.reconcileAuthorizedSessionOwner(b);
    expect(otherTabSession.getSessionOwner()).toBe(b);
    expect(getStoredSessionOwnerKey()).toBe(b);
    expect(getSessionOwner()).toBe(a);
    await seedRecord();
    const read = watchRecord();
    await updateShift(['SYNTHETIC UPDATE HIDDEN AFTER REAL B SIGN-IN']);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(read()).toBeUndefined();
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });
});
