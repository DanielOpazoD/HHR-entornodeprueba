import { readDailyRecordQuery } from '@/tests/utils/readDailyRecordQuery';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore/firestoreRecordQueries';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  createDailyRecordQueryOptions,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  ensureDailyRecordRemoteFreshness,
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { getTodayISO } from '@/utils/dateCoreUtils';

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: {
    currentUser: { uid: 'synthetic-cache-reader', email: 'hospitalizados@hospitalhangaroa.cl' },
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

describeEmulator('server confirmation with real Firestore cache metadata', () => {
  let environment: RulesTestEnvironment;
  const cleanups: Array<() => void> = [];

  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host ?? '');
    if (!endpoint) throw new Error('Use the canonical loopback Firestore emulator launcher.');
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-server-confirmation',
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    resetDailyRecordFreshnessGateForTests();
    setFirestoreEnabled(true);
  });

  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    resetDailyRecordFreshnessGateForTests();
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  const openReader = () => {
    const db = environment
      .authenticatedContext('synthetic-cache-reader', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    activeDb = db;
    return db;
  };

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

  it('shows cached data but only the metadata-only server update confirms freshness', async () => {
    const db = openReader();
    const record = await seedRecord();
    expect((await getRecordFromFirestoreDetailed(date, { source: 'server' })).serverConfirmed).toBe(
      true
    );
    await db.disableNetwork();
    try {
      expect(await getRecordFromFirestoreDetailed(date)).toMatchObject({
        status: 'resolved',
        serverConfirmed: false,
      });
      markDailyRecordTabHidden(0);
      markDailyRecordTabVisible(360_000);
      const read = watchRecord();
      await waitFor(() => expect(read()?.record?.nursesDayShift).toEqual(record.nursesDayShift));
      expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
      expect(read()?.runtime.serverConfirmed).toBe(false);
      await db.enableNetwork();
      await waitFor(() =>
        expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed')
      );
      expect(read()?.runtime.serverConfirmed).toBe(true);
      expect(read()?.record?.nursesDayShift).toEqual(record.nursesDayShift);
    } finally {
      await db.enableNetwork();
    }
  });

  describe('returning to a tab after a long absence', () => {
    const returnToTab = async (whileHidden: () => Promise<unknown> = async () => {}) => {
      openReader();
      await seedRecord();
      const client = new QueryClient();
      const repository = { getForDateWithMeta, subscribeDetailed };
      const stop = createDailyRecordSubscription(repository, date, client);
      cleanups.push(() => {
        stop?.();
        client.clear();
      });
      const options = createDailyRecordQueryOptions(repository, date, client);
      const key = getDailyRecordQueryKey(date);
      await client.fetchQuery({ ...options, staleTime: 0 });
      markDailyRecordTabHidden(0);
      await whileHidden();
      markDailyRecordTabVisible(720_000);
      expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');

      await ensureDailyRecordRemoteFreshness({
        date,
        queryClient: client,
        ...options,
        reason: 'resume',
      });

      expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');
      return client.getQueryData<DailyRecordQueryResult>(key);
    };

    it('reopens editing when nothing changed in the meantime', async () => {
      const shown = await returnToTab();

      expect(shown?.runtime.serverConfirmed).toBe(true);
    });

    it('reopens editing and shows what another user wrote in the meantime', async () => {
      const shown = await returnToTab(async () => {
        await environment.withSecurityRulesDisabled(context =>
          context
            .firestore()
            .doc(recordPath)
            .update({
              nursesDayShift: ['Synthetic nurse C'],
              lastUpdated: new Date().toISOString(),
            })
        );
        await waitFor(async () =>
          expect((await getRecordFromFirestoreDetailed(date)).record?.nursesDayShift).toEqual([
            'Synthetic nurse C',
          ])
        );
      });

      expect(shown?.runtime.serverConfirmed).toBe(true);
      expect(shown?.record?.nursesDayShift).toEqual(['Synthetic nurse C']);
    });
  });

  it('does not confirm an offline absence and rejects a server-only read', async () => {
    const db = openReader();
    expect(await getRecordFromFirestoreDetailed(date, { source: 'server' })).toMatchObject({
      status: 'missing',
      record: null,
      serverConfirmed: true,
    });
    await db.disableNetwork();
    try {
      expect(await getRecordFromFirestoreDetailed(date)).toMatchObject({
        status: 'failed',
        record: null,
        serverConfirmed: false,
      });
      const read = watchRecord();
      await waitFor(() => expect(read()?.runtime.serverConfirmed).toBe(false));
      expect(read()?.record).toBeNull();
      expect(read()?.runtime.availabilityState).not.toBe('confirmed_missing');
      const result = await readDailyRecordQuery({ getForDateWithMeta }, date);
      expect(result.record).toBeNull();
      expect(result.runtime.availabilityState).not.toBe('confirmed_missing');
      expect(result.runtime.serverConfirmed).toBe(false);
      expect(await getRecordFromFirestoreDetailed(date, { source: 'server' })).toMatchObject({
        status: 'failed',
        record: null,
        serverConfirmed: false,
      });
    } finally {
      await db.enableNetwork();
    }
  });
});
