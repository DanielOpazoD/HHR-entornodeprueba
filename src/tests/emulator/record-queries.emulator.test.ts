import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { HospitalConfigService } from '@/services/config/HospitalConfigService';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));

import {
  getAvailableDatesFromFirestore,
  getRecentAvailableDatesFromFirestore,
  getPreviousRecordDateFromFirestore,
  getRecordPagesFromFirestore,
  getRecordFromFirestore,
  getRecordFromFirestoreDetailed,
  getRecordsRangeFromFirestore,
  getMonthRecordsFromFirestore,
  isFirestoreAvailable,
  subscribeToRecord,
} from '@/services/storage/firestore/firestoreRecordQueries';

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const path = (id: string) => `hospitals/hanga_roa/dailyRecords/${id}`;
const record = (date: string) => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  lastUpdated: `${date}T12:00:00Z`,
});

describeEmulator('record queries against the real server', () => {
  let environment: RulesTestEnvironment;
  beforeAll(async () => {
    const config = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    if (!['127.0.0.1', 'localhost'].includes(config.host))
      throw new Error('Local emulator required');
    // The required CLI launcher loads firestore.rules; do not upload the same rules again.
    // The denied-range test below also verifies that the emulator enforces them.
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-n5d-record-queries',
      firestore: config,
    });
  });
  beforeEach(async () => {
    HospitalConfigService.setHospitalId('hanga_roa');
    await environment.clearFirestore();
  });
  beforeAll(() => {
    activeDb = environment
      .authenticatedContext('synthetic-n5d-nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });
  afterAll(async () => {
    await environment?.cleanup();
  });
  const seed = (entries: Array<[string, Record<string, unknown>]>) =>
    environment.withSecurityRulesDisabled(async context => {
      const batch = context.firestore().batch();
      for (const [id, data] of entries) batch.set(context.firestore().doc(path(id)), data);
      await batch.commit();
    });
  const seedDates = (dates: string[]) => seed(dates.map(date => [date, record(date)]));

  it('returns all date ids descending, including documents without a date field', async () => {
    await seedDates(['2026-03-10', '2026-03-12', '2026-03-11']);
    await seed([['2026-03-09', { beds: {} }]]);
    expect(await getAvailableDatesFromFirestore()).toEqual([
      '2026-03-12',
      '2026-03-11',
      '2026-03-10',
      '2026-03-09',
    ]);
  });

  it('bounds recent and previous dates and falls back across a long gap', async () => {
    await seedDates(['2026-01-01', '2026-03-01', '2026-03-02', '2026-03-30', '2026-04-01']);
    expect(await getRecentAvailableDatesFromFirestore('2026-04-01')).toEqual([
      '2026-04-01',
      '2026-03-30',
      '2026-03-02',
    ]);
    expect(await getPreviousRecordDateFromFirestore('2026-04-01')).toBe('2026-03-30');
    expect(await getPreviousRecordDateFromFirestore('2026-03-01')).toBe('2026-01-01');
    expect(await getPreviousRecordDateFromFirestore('2025-12-31')).toBeNull();
  });

  it('reads and maps a single server record and confirms a missing record', async () => {
    await seedDates(['2026-03-14']);
    expect(await getRecordFromFirestore('2026-03-14')).toMatchObject({
      date: '2026-03-14',
      beds: {},
    });
    expect(await getRecordFromFirestoreDetailed('2026-03-14', { source: 'server' })).toMatchObject({
      status: 'resolved',
      serverConfirmed: true,
      hasPendingWrites: false,
    });
    expect(await getRecordFromFirestoreDetailed('2026-03-15', { source: 'server' })).toEqual({
      status: 'missing',
      serverConfirmed: true,
      record: null,
    });
    expect(await getRecordFromFirestore('2026-03-15')).toBeNull();
    expect(await isFirestoreAvailable()).toBe(true);
  });

  it('returns inclusive date ranges ascending and only the requested month', async () => {
    await seedDates(['2026-01-31', '2026-02-01', '2026-02-14', '2026-02-28', '2026-03-01']);
    for (const requireServer of [false, true]) {
      const rows = await getRecordsRangeFromFirestore('2026-02-01', '2026-02-28', {
        requireServer,
      });
      expect(rows.map(row => row.date)).toEqual(['2026-02-01', '2026-02-14', '2026-02-28']);
      expect(rows[0].beds.R1.patientName).toBe('');
    }
    expect((await getMonthRecordsFromFirestore(2026, 1)).map(row => row.date)).toEqual([
      '2026-02-01',
      '2026-02-14',
      '2026-02-28',
    ]);
    expect(
      await getRecordsRangeFromFirestore('2025-01-01', '2025-01-31', { requireServer: true })
    ).toEqual([]);
  });

  it('paginates tied dates without losing documents and excludes missing date fields', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    await seed(ids.map(id => [id, { ...record('2026-03-01'), lastUpdated: `${id}T12:00:00Z` }]));
    await seed([['2026-03-22', { beds: {} }]]);
    const pages = [];
    try {
      for await (const page of getRecordPagesFromFirestore()) {
        pages.push(page);
        HospitalConfigService.setHospitalId('synthetic-other-hospital');
      }
    } finally {
      HospitalConfigService.setHospitalId('hanga_roa');
    }
    expect(pages.map(page => page.length)).toEqual([20, 1]);
    expect(pages.flat().map(row => row.lastUpdated)).toEqual(
      [...ids].reverse().map(id => `${id}T12:00:00Z`)
    );
  });

  it('orders pages by date and checks the empty final page at an exact multiple', async () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    await seedDates(dates);
    const pages = [];
    for await (const page of getRecordPagesFromFirestore()) pages.push(page);
    expect(pages.map(page => page.length)).toEqual([20, 0]);
    expect(pages.flat().map(row => row.date)).toEqual([...dates].reverse());
    const controller = new AbortController();
    const iterator = getRecordPagesFromFirestore(controller.signal);
    expect((await iterator.next()).value).toHaveLength(20);
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a denied range instead of reporting no records', async () => {
    activeDb = environment.unauthenticatedContext().firestore();
    try {
      await expect(
        getRecordsRangeFromFirestore('2026-03-01', '2026-03-31', { requireServer: true })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      activeDb = environment
        .authenticatedContext('synthetic-n5d-nurse', {
          email: 'hospitalizados@hospitalhangaroa.cl',
          role: 'nurse_hospital',
        })
        .firestore();
    }
  });

  it('delivers server-confirmed subscription data and then a confirmed deletion', async () => {
    await seedDates(['2026-03-14']);
    const received: Array<{ record: unknown; pending: boolean; metadata: unknown }> = [];
    const unsubscribe = subscribeToRecord('2026-03-14', (value, pending, metadata) =>
      received.push({ record: value, pending, metadata })
    );
    try {
      await vi.waitFor(
        () =>
          expect(received).toContainEqual({
            record: expect.objectContaining({ date: '2026-03-14' }),
            pending: false,
            metadata: { fromCache: false, hasPendingWrites: false },
          }),
        { timeout: 10000 }
      );
      await environment.withSecurityRulesDisabled(context =>
        context.firestore().doc(path('2026-03-14')).delete()
      );
      await vi.waitFor(
        () =>
          expect(received).toContainEqual({
            record: null,
            pending: false,
            metadata: { fromCache: false, hasPendingWrites: false },
          }),
        { timeout: 10000 }
      );
    } finally {
      unsubscribe();
    }
  });
});
