import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import type { DailyRecord } from '@/types/domain/dailyRecord';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => invoke }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: async () => ({}) },
}));
import { saveDailyRecordWithClinicalAuthorityCallable as save } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST
    ? describe
    : describe.skip;
const date = '2026-10-19';
const recordPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const record = {
  date,
  lastUpdated: `${date}T10:00:00.000Z`,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  nursesDayShift: [],
  nursesNightShift: [],
  activeExtraBeds: [],
  cudyrLocked: true,
  cudyrLockedAt: `${date}T09:00:00.000Z`,
} as unknown as DailyRecord;

describeEmulator('authority lost response with server-only Firestore evidence', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-hhr-authority-response',
      firestore: {
        ...resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST),
        rules: readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      },
    });
    activeDb = env
      .authenticatedContext('synthetic-nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    invoke.mockReset();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it.each([true, false])(
    'accepts only the exact committed mutation (matches=%s)',
    async matches => {
      const error = Object.assign(new Error('Synthetic lost response'), {
        code: 'functions/deadline-exceeded',
      });
      const committed = {
        ...record,
        lastUpdated: `${date}T10:01:00.000Z`,
        meta: { revision: 2, lastMutationId: matches ? 'synthetic-write' : 'another-write' },
      };
      invoke.mockImplementationOnce(async () => {
        await env.withSecurityRulesDisabled(async context => {
          await setDoc(doc(context.firestore(), recordPath), committed);
        });
        throw error;
      });
      const result = save({
        date,
        record,
        mode: 'enforced',
        syncContract: { mutationId: 'synthetic-write' },
      });
      if (matches) {
        expect(await result).toMatchObject({
          success: true,
          revision: 2,
          recordState: { record: { cudyrLocked: true, cudyrLockedAt: record.cudyrLockedAt } },
        });
      } else {
        await expect(result).rejects.toBe(error);
      }
      expect(invoke).toHaveBeenCalledTimes(1);
      await env.withSecurityRulesDisabled(async context => {
        expect((await getDocFromServer(doc(context.firestore(), recordPath))).data()).toEqual(
          committed
        );
      });
    }
  );

  it('accepts a commit stamped with a Firestore Timestamp, as the authority callables write it', async () => {
    const error = Object.assign(new Error('Synthetic lost response'), {
      code: 'functions/deadline-exceeded',
    });
    const committed = {
      ...record,
      lastUpdated: Timestamp.fromDate(new Date(`${date}T10:01:00.000Z`)),
      meta: { revision: 2, lastMutationId: 'synthetic-write' },
    };
    invoke.mockImplementationOnce(async () => {
      await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), recordPath), committed);
      });
      throw error;
    });

    await expect(
      save({ date, record, mode: 'enforced', syncContract: { mutationId: 'synthetic-write' } })
    ).resolves.toMatchObject({
      success: true,
      revision: 2,
      recordState: { lastUpdated: `${date}T10:01:00.000Z` },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
