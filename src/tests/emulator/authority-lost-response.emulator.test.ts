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
import {
  saveDailyRecordWithClinicalAuthorityCallable as save,
  patchDailyRecordWithClinicalAuthorityCallable as patch,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

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
      projectId: 'demo-hhr-n5d3-authority-response',
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

  const payload = {
    date,
    record,
    mode: 'enforced' as const,
    syncContract: { mutationId: 'synthetic-write' },
  };
  const committed = () => ({
    ...record,
    beds: { R1: { patientName: 'Paciente sintético', cudyr: { changeClothes: 2 } } },
    lastUpdated: `${date}T10:01:00.000Z`,
    meta: { revision: 2, lastMutationId: 'synthetic-write' },
  });
  const loseResponse = (data: Record<string, unknown> | null, code = 'deadline-exceeded') => {
    const error = Object.assign(new Error('Synthetic lost response'), {
      code: `functions/${code}`,
    });
    invoke.mockImplementation(async actual => {
      expect(actual).toMatchObject({ date, syncContract: payload.syncContract });
      if (data)
        await env.withSecurityRulesDisabled(async context => {
          await setDoc(doc(context.firestore(), recordPath), data);
        });
      throw error;
    });
    return error;
  };

  it.each(['save', 'patch'] as const)(
    'confirms %s without another write and retains server CUDYR',
    async kind => {
      const data = committed();
      loseResponse(data);
      const result =
        kind === 'save'
          ? await save(payload)
          : await patch({ ...payload, patch: { nurses: ['Sintética'] } });
      expect(result).toMatchObject({
        success: true,
        mutationId: 'synthetic-write',
        revision: 2,
        recordState: {
          record: { cudyrLocked: true, cudyrLockedAt: record.cudyrLockedAt, beds: data.beds },
        },
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(payload.record).toEqual(record);
      await env.withSecurityRulesDisabled(async context => {
        expect((await getDocFromServer(doc(context.firestore(), recordPath))).data()).toEqual(data);
      });
    }
  );

  it.each(['unavailable', 'internal', 'unknown'])(
    'recovers ambiguous %s with an exact server receipt',
    async code => {
      loseResponse(committed(), code);
      expect((await save(payload)).success).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  );

  it('accepts the real Firestore Timestamp written by authority callables', async () => {
    loseResponse({
      ...committed(),
      lastUpdated: Timestamp.fromDate(new Date(`${date}T10:01:00.000Z`)),
    });
    await expect(save(payload)).resolves.toMatchObject({
      success: true,
      revision: 2,
      mutationId: 'synthetic-write',
      recordState: { lastUpdated: `${date}T10:01:00.000Z` },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['different mutation', { meta: { revision: 3, lastMutationId: 'newer-write' } }],
    ['different day', { date: '2026-10-18' }],
    ['missing revision', { meta: { lastMutationId: 'synthetic-write' } }],
    ['invalid timestamp', { lastUpdated: 'invalid' }],
    ['numeric stamp', { lastUpdated: 1_792_000_000_000 }],
    ['missing stamp', { lastUpdated: null }],
    ['plain map stamp', { lastUpdated: { seconds: 1 } }],
  ])('retains the error for %s even when patient values match', async (_label, overrides) => {
    const error = loseResponse({ ...committed(), ...overrides });
    await expect(save(payload)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('retains the original error when the server has no receipt', async () => {
    const error = loseResponse(null);
    await expect(save(payload)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
