import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

// Instrument the SDK boundary without replacing its query or server behavior.
const reads = vi.hoisted(() => ({ attempts: 0, sizes: [] as number[] }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocsFromServer: async (query: Parameters<typeof actual.getDocsFromServer>[0]) => {
      reads.attempts += 1;
      const snapshot = await actual.getDocsFromServer(query);
      reads.sizes.push(snapshot.size);
      return snapshot;
    },
  };
});
let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));

import { getPatientMovementHistoryDetailed } from '@/services/patient/patientHistoryService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  clearAllRecords,
  getAllRecords,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';

const runEmulatorTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const describeEmulator = runEmulatorTests ? describe : describe.skip;
const patientId = 'synthetic-history-1';
const period = { startDate: '2026-03-06', endDate: '2026-03-08' };
const record = (date: string, overrides: Partial<DailyRecord> = {}): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  lastUpdated: `${date}T12:00:00.000Z`,
  ...overrides,
});
const admitted = (date: string) =>
  record(date, {
    beds: {
      R1: {
        bedId: 'R1',
        rut: patientId,
        patientName: 'Synthetic history patient',
        admissionDate: date,
      } as never,
    },
  });
const discharged = (date: string) =>
  record(date, {
    discharges: [
      {
        id: `synthetic-${date}`,
        rut: patientId,
        patientName: 'Synthetic history patient',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'MEDIA',
        status: 'Vivo',
        diagnosis: 'Synthetic diagnosis',
        dischargeType: 'Domicilio (Habitual)',
        time: '12:00',
      },
    ],
  });
const recordPath = (date: string) => `hospitals/hanga_roa/dailyRecords/${date}`;

describeEmulator('patient history range and authoritative reads', () => {
  let environment: RulesTestEnvironment;
  beforeAll(async () => {
    const config = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-history-range-test',
      firestore: { ...config, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => {
    await environment.clearFirestore();
    await clearAllRecords();
    activeDb = environment
      .authenticatedContext('history-nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    setFirestoreEnabled(true);
    reads.attempts = 0;
    reads.sizes.length = 0;
  });
  afterAll(async () => {
    await environment?.cleanup();
  });

  it('reads three requested documents from a year archive and retains older episodes on explicit full lookup', async () => {
    const episodes = new Map([
      ['2026-02-02', admitted('2026-02-02')],
      ['2026-02-03', discharged('2026-02-03')],
      ['2026-03-06', admitted('2026-03-06')],
      ['2026-03-08', discharged('2026-03-08')],
    ]);
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const batch = db.batch();
      for (let day = 0; day < 365; day += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
        batch.set(db.doc(recordPath(date)), episodes.get(date) ?? record(date));
      }
      await batch.commit();
    });
    const bounded = await getPatientMovementHistoryDetailed(patientId, { dateRange: period });
    expect(bounded.source).toBe('server');
    expect(bounded.history?.movements.map(item => `${item.date}:${item.type}`)).toEqual([
      '2026-03-06:admission',
      '2026-03-08:discharge',
    ]);
    expect(reads.sizes).toEqual([3]);
    expect(reads.attempts).toBe(1);
    const full = await getPatientMovementHistoryDetailed(patientId, {
      forceFullRemoteHydration: true,
    });
    expect(full.history?.movements.map(item => `${item.date}:${item.type}`)).toEqual([
      '2026-02-02:admission',
      '2026-02-03:discharge',
      '2026-03-06:admission',
      '2026-03-08:discharge',
    ]);
    expect(reads.sizes).toEqual([3, 365]);
    expect(reads.attempts).toBe(2);
    expect(await getAllRecords()).toEqual({});
  });

  it('does not resurrect a deleted server day from either SDK cache or editable local data', async () => {
    const cached = admitted('2026-03-06');
    expect((await saveRecordStrict(cached)).ok).toBe(true);
    await environment.withSecurityRulesDisabled(context =>
      context.firestore().doc(recordPath(cached.date)).set(cached)
    );
    expect(
      (await getPatientMovementHistoryDetailed(patientId, { dateRange: period })).history
    ).not.toBeNull();
    await environment.withSecurityRulesDisabled(context =>
      context.firestore().doc(recordPath(cached.date)).delete()
    );
    await expect(
      getPatientMovementHistoryDetailed(patientId, { dateRange: period })
    ).resolves.toEqual({ history: null, source: 'server' });
    expect(reads.sizes).toEqual([1, 0]);
    expect((await getAllRecords())[cached.date].beds.R1.rut).toBe(patientId);
  });

  it('marks permission failure as partial and bounds local fallback before a successful retry', async () => {
    expect((await saveRecordStrict(admitted('2026-02-02'))).ok).toBe(true);
    expect((await saveRecordStrict(admitted('2026-03-07'))).ok).toBe(true);
    activeDb = environment.unauthenticatedContext().firestore();
    const partial = await getPatientMovementHistoryDetailed(patientId, { dateRange: period });
    expect(partial.source).toBe('local');
    expect(partial.history?.movements.map(item => item.date)).toEqual(['2026-03-07']);
    expect(reads.attempts).toBe(1);
    expect(reads.sizes).toEqual([]);
    activeDb = environment
      .authenticatedContext('history-nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    await expect(
      getPatientMovementHistoryDetailed(patientId, { dateRange: period })
    ).resolves.toEqual({ history: null, source: 'server' });
    expect(reads.attempts).toBe(2);
    expect(reads.sizes).toEqual([0]);
  });
});
