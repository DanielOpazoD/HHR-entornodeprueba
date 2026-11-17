import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

/**
 * The nurse window (yesterday, today and tomorrow on the hospital clock) follows the day's date,
 * as the Firestore rules do. The authority Functions write with the Admin SDK, so they must not
 * take the window from a `dateTimestamp` the client sends or that an earlier save stored.
 */
const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST;
(enabled ? describe : describe.skip)('nurse editing window in the authority Functions', () => {
  const date = '2026-05-13';
  const stamp = '2026-05-13T12:00:00.000Z';
  const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
  // Hospital midnight of 2026-05-13 (Pacific/Easter is UTC-6 in May).
  const honestTimestamp = Date.parse('2026-05-13T06:00:00.000Z');
  let app: App;
  let db: Firestore;
  let role = 'nurse_hospital';
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
      throw new Error('Local emulator required');
    app = initializeApp({ projectId: 'demo-hhr-nurse-window' }, 'nurse-editing-window');
    db = getFirestore(app);
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => role,
    });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  const seed = async (storedTimestamp: number) => {
    await db.recursiveDelete(db.doc('hospitals/hanga_roa'));
    await db.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({ schemaVersion: 2 });
    await db.doc(dayPath).set({
      ...makeRecord(),
      dateTimestamp: storedTimestamp,
      lastUpdated: Timestamp.fromDate(new Date(stamp)),
      meta: { revision: 2, lastMutationId: 'synthetic-prior' },
    });
  };
  const save = (dateTimestamp: number) =>
    api.saveDailyRecordWithClinicalAuthority.run(
      {
        date,
        mode: 'enforced',
        expectedLastUpdated: stamp,
        record: {
          ...makeRecord(),
          dateTimestamp,
          beds: { R1: { ...makeRecord().beds.R1, pathology: 'CAMBIO SINTETICO' } },
        },
      },
      makeContext()
    );
  // Every nurse patch keeps to the window: a structural field (bed type) and a clinical one
  // (diagnosis), as the rules do for any direct nurse update.
  const patches = [
    ['structural', { 'beds.R1.bedMode': 'Cuna' }],
    ['clinical', { 'beds.R1.pathology': 'DIAGNOSTICO SINTETICO' }],
  ] as const;
  const patchWith = (fields: Record<string, unknown>) => () =>
    api.patchDailyRecordWithClinicalAuthority.run(
      { date, mode: 'enforced', expectedLastUpdated: stamp, patch: fields },
      makeContext()
    );
  const patch = patchWith(patches[0][1]);
  const expectUnchanged = async (attempt: () => Promise<unknown>) => {
    const before = await db.doc(dayPath).get();
    await expect(attempt()).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'The nurse editing window for this daily record has closed.',
    });
    const after = await db.doc(dayPath).get();
    expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
  };

  beforeEach(() => {
    role = 'nurse_hospital';
  });
  afterEach(() => vi.useRealTimers());
  // Seeding runs on real time; the clock moves to the instant under test only for the call.
  const at = (instant: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(instant) });

  it('refuses a full save of an old day that carries a current timestamp', async () => {
    await seed(honestTimestamp);
    at('2026-05-20T15:00:00.000Z');
    await expectUnchanged(() => save(Date.now()));
  });

  it.each(patches)('refuses a nurse %s patch of a day seven days old', async (_kind, fields) => {
    await seed(honestTimestamp);
    at('2026-05-20T15:00:00.000Z');
    await expectUnchanged(patchWith(fields));
  });

  it('refuses a patch of an old day whose stored timestamp was rewritten to a current one', async () => {
    await seed(Date.parse('2026-05-20T12:00:00.000Z'));
    at('2026-05-20T15:00:00.000Z');
    await expectUnchanged(patch);
  });

  it.each([
    // 2026-05-12 23:30 in Rapa Nui: the 13th is tomorrow.
    ['the day before, on the hospital clock', '2026-05-13T05:30:00.000Z'],
    ['the day itself', '2026-05-13T15:00:00.000Z'],
    // 2026-05-14 23:30 in Rapa Nui, already 2026-05-15 in UTC.
    ['the last hour of the day after, on the hospital clock', '2026-05-15T05:30:00.000Z'],
  ])('accepts a nurse save and patch on %s', async (_label, instant) => {
    await seed(honestTimestamp);
    at(instant);
    await expect(save(honestTimestamp)).resolves.toMatchObject({ success: true, revision: 3 });
    vi.useRealTimers();
    expect((await db.doc(dayPath).get()).data()?.beds.R1.pathology).toBe('CAMBIO SINTETICO');
    for (const [, fields] of patches) {
      vi.useRealTimers();
      await seed(honestTimestamp);
      at(instant);
      await expect(patchWith(fields)()).resolves.toMatchObject({ success: true, revision: 3 });
    }
  });

  it.each([
    // 2026-05-15 00:30 in Rapa Nui.
    ['once the day after has ended', '2026-05-15T06:30:00.000Z'],
    // 2026-05-11 23:30 in Rapa Nui, already 2026-05-12 in UTC: the 13th is two days ahead.
    ['before the day before has started', '2026-05-12T05:30:00.000Z'],
  ])('refuses the nurse %s on the hospital clock', async (_label, instant) => {
    await seed(honestTimestamp);
    at(instant);
    await expectUnchanged(() => save(honestTimestamp));
    for (const [, fields] of patches) {
      vi.useRealTimers();
      await seed(honestTimestamp);
      at(instant);
      await expectUnchanged(patchWith(fields));
    }
  });

  it('keeps the administrator outside the window', async () => {
    role = 'admin';
    await seed(honestTimestamp);
    at('2026-05-20T15:00:00.000Z');
    await expect(save(honestTimestamp)).resolves.toMatchObject({ success: true, revision: 3 });
    for (const [, fields] of patches) {
      vi.useRealTimers();
      await seed(honestTimestamp);
      at('2026-05-20T15:00:00.000Z');
      await expect(patchWith(fields)()).resolves.toMatchObject({ success: true, revision: 3 });
    }
    expect((await db.doc(dayPath).get()).data()?.beds.R1.pathology).toBe('DIAGNOSTICO SINTETICO');
  });
});
