/* @flake-safe: The emulator write window requires today's synthetic census date and real write times. */
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

const runEmulatorTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const describeEmulator = runEmulatorTests ? describe : describe.skip;

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));

import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import * as recordWrites from '@/services/storage/firestore/firestoreRecordWrites';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  clearAllRecords,
  getRecordForDate,
  saveRecord,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearAllSyncQueue,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
} from '@/services/storage/sync';
import { getTodayISO } from '@/utils/dateCoreUtils';

const DATE = getTodayISO();
const RECORD_PATH = `hospitals/hanga_roa/dailyRecords/${DATE}`;

const baseRecord = (): DailyRecord => ({
  date: DATE,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${DATE}T00:00:01.000Z`,
  nurses: [],
  nursesDayShift: ['SINTETICA BASE'],
  nursesNightShift: [],
  tensDayShift: ['SINTETICO BASE'],
  tensNightShift: [],
  activeExtraBeds: [],
  handoffNovedadesDayShift: 'BASE SINTETICA',
  dateTimestamp: Date.parse(`${DATE}T00:00:00.000Z`),
});
const localRecord = async (): Promise<DailyRecord> => {
  const record = await getRecordForDate(DATE);
  if (!record) throw new Error('missing synthetic local record');
  return record;
};

describeEmulator('the outbox publishes compacted offline work through Firestore', () => {
  let testEnv: RulesTestEnvironment;
  const seedRemote = (record: object) =>
    testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(RECORD_PATH).set(record);
    });
  const readRemote = async (): Promise<Record<string, unknown> | undefined> => {
    let data: Record<string, unknown> | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      data = (await context.firestore().doc(RECORD_PATH).get()).data();
    });
    return data;
  };
  /** Runs the real queue once the pre-outbox holds of the queued writes have expired. */
  const publishQueue = async () => {
    const later = Date.now() + 10_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await processSyncQueue();
    } finally {
      clock.mockRestore();
    }
  };

  beforeAll(async () => {
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-sync-outbox-compaction',
      firestore: {
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
        host: emulatorConfig.host,
        port: emulatorConfig.port,
      },
    });
    activeDb = testEnv
      .authenticatedContext('synthetic_nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  }, 120_000);

  beforeEach(async () => {
    // Direct client writes and the transactional queue publish, not the authority callables.
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
    await testEnv.clearFirestore();
    await clearAllRecords();
    await clearAllSyncQueue();
    await seedRemote(baseRecord());
    await saveRecord(baseRecord());
  });
  afterEach(() => {
    setFirestoreEnabled(true);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('keeps a remote edit made between two offline edits of the same day', async () => {
    setFirestoreEnabled(false);
    await updatePartialDetailed(
      DATE,
      { nursesDayShift: ['SINTETICA A'] },
      { baseRecord: baseRecord() }
    );
    const afterFirstEdit = await localRecord();
    await seedRemote({
      ...baseRecord(),
      lastUpdated: new Date(Date.parse(afterFirstEdit.lastUpdated) - 1).toISOString(),
      handoffNovedadesDayShift: 'EDICION REMOTA INDEPENDIENTE',
      meta: { lastChangedPaths: ['handoffNovedadesDayShift'] },
    });
    await updatePartialDetailed(
      DATE,
      { tensDayShift: ['SINTETICO B'] },
      { baseRecord: afterFirstEdit }
    );

    setFirestoreEnabled(true);
    await publishQueue();

    expect(await readRemote()).toMatchObject({
      nursesDayShift: expect.arrayContaining(['SINTETICA A']),
      tensDayShift: expect.arrayContaining(['SINTETICO B']),
      handoffNovedadesDayShift: 'EDICION REMOTA INDEPENDIENTE',
    });
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('publishes offline A after the direct ACK and remote mutation marker of B', async () => {
    setFirestoreEnabled(false);
    await updatePartialDetailed(
      DATE,
      { nursesDayShift: ['SINTETICA SIN RED'] },
      { baseRecord: baseRecord() }
    );
    setFirestoreEnabled(true);
    await updatePartialDetailed(
      DATE,
      { tensDayShift: ['SINTETICO DIRECTO'] },
      { baseRecord: await localRecord() }
    );

    await publishQueue();

    expect(await readRemote()).toMatchObject({
      nursesDayShift: expect.arrayContaining(['SINTETICA SIN RED']),
      tensDayShift: expect.arrayContaining(['SINTETICO DIRECTO']),
    });
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('retains B through a full-save ACK and publishes it on replay', async () => {
    let remoteCommitted!: () => void;
    const committed = new Promise<void>(resolve => {
      remoteCommitted = resolve;
    });
    let releaseAck!: () => void;
    const holdAck = new Promise<void>(resolve => {
      releaseAck = resolve;
    });
    const saveRemote = recordWrites.saveRecordToFirestore;
    vi.spyOn(recordWrites, 'saveRecordToFirestore').mockImplementationOnce(async (...args) => {
      const receipt = await saveRemote(...args);
      remoteCommitted();
      await holdAck;
      return receipt;
    });
    const saving = saveDetailed(
      { ...baseRecord(), nursesDayShift: ['SINTETICA A'] },
      baseRecord().lastUpdated,
      {
        baseRecord: baseRecord(),
        requireConfirmedRecord: true,
      }
    );
    await committed;
    const sent = await localRecord();
    const later = {
      ...sent,
      tensDayShift: ['SINTETICO B'],
      lastUpdated: new Date().toISOString(),
    };
    try {
      await queueDailyRecordSyncTaskWithLocalRecord(
        later,
        {
          syncContract: {
            mutationId: 'synthetic-later-b',
            changedPaths: ['tensDayShift'],
            expectedVersion: sent.lastUpdated,
          },
        },
        { wholeRecordBase: sent }
      );
      expect(await readRemote()).toMatchObject({
        nursesDayShift: ['SINTETICA A'],
        tensDayShift: ['SINTETICO BASE'],
      });
    } finally {
      releaseAck();
    }
    const result = await saving;
    expect(result.confirmedRecord?.tensDayShift).toEqual(['SINTETICO BASE']);
    expect(result.localProjectionRecord?.tensDayShift).toEqual(['SINTETICO B']);
    expect((await localRecord()).tensDayShift).toEqual(['SINTETICO B']);
    expect(await hospitalDB.syncQueue.count()).toBe(1);

    await publishQueue();

    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    expect(await readRemote()).toMatchObject({
      nursesDayShift: ['SINTETICA A'],
      tensDayShift: ['SINTETICO B', '', ''],
    });
    expect((await localRecord()).tensDayShift).toEqual(['SINTETICO B', '', '']);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
