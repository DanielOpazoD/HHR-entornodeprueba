/* @flake-safe: Date usage aligns the seeded record date with current execution time. */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
type TestFirestore = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;

vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));

import { executeDeleteDailyRecord } from '@/application/daily-record/commands/deleteDailyRecordCommand';
import { defaultDailyRecordWritePort } from '@/application/ports/dailyRecordPort';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { clearAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { clearAllSyncQueue } from '@/services/storage/sync';

const CURRENT_RECORD_DATE = new Date().toISOString().slice(0, 10);

const buildRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T10:00:00.000Z`,
  nurses: [],
  nursesDayShift: [],
  nursesNightShift: [],
  tensDayShift: [],
  tensNightShift: [],
  activeExtraBeds: [],
  dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
});

// The real production deletion path that usePersistence.resetDay routes through.
const deleteRecord = (date: string) => defaultDailyRecordWritePort.delete(date);

describeEmulator('Firestore emulator — DAILY_RECORD_DELETED fail-closed', () => {
  let testEnv: RulesTestEnvironment;
  let adminDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-delete-failclosed-test',
      firestore: { rules, host: emulatorConfig.host, port: emulatorConfig.port },
    });

    adminDb = testEnv
      .authenticatedContext('user_admin', {
        email: 'daniel.opazo@hospitalhangaroa.cl',
        role: 'admin',
      })
      .firestore();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await clearAllRecords();
    await clearAllSyncQueue();
    setFirestoreEnabled(true);
    activeDb = adminDb;
  });

  afterAll(async () => {
    // Restore the global Firestore runtime flag so this suite does not leak `enabled` state.
    setFirestoreEnabled(false);
    await testEnv.cleanup();
  });

  const seedRecord = async (date: string) => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set(buildRecord(date));
    });
  };

  it('does NOT delete the record from Firestore when the audit fails (fail-closed proof)', async () => {
    const date = CURRENT_RECORD_DATE;
    await seedRecord(date);

    const outcome = await executeDeleteDailyRecord(
      { date, deletedBy: 'admin@h.cl', deleteRecord },
      { writeAuditEvent: vi.fn().mockResolvedValue({ status: 'failed', data: null, issues: [] }) }
    );

    expect(outcome.status).toBe('failed');
    // Against REAL Firestore: the clinical record is still there — never deleted without an audit.
    expect(await getRecordFromFirestore(date)).not.toBeNull();
  });

  it('deletes the record from Firestore when the audit succeeds (control)', async () => {
    const date = CURRENT_RECORD_DATE;
    await seedRecord(date);

    const outcome = await executeDeleteDailyRecord(
      { date, deletedBy: 'admin@h.cl', deleteRecord },
      { writeAuditEvent: vi.fn().mockResolvedValue({ status: 'success', data: null, issues: [] }) }
    );

    expect(outcome.status).toBe('success');
    expect(await getRecordFromFirestore(date)).toBeNull();
  });
});
