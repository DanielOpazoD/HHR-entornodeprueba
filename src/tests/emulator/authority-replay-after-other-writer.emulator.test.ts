import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';

// The shipped patch and whole-day handlers with their real admin transactions; synthetic claims and
// data. A's answer is lost after the server committed, another computer saves, and A sends the
// very same request again (the callable's retry or the queue's replay).
const require = createRequire(import.meta.url);
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');

const emulator = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
const projectId = 'demo-hhr-authority-replay-other-writer';
const root = 'hospitals/hanga_roa';
const context = (uid: string) => ({ auth: { uid, token: { email: `${uid}@example.invalid` } } });
const patient = (bedId: string, rut: string) => ({
  bedId,
  patientName: `PACIENTE SINTETICO ${bedId}`,
  rut,
  admissionDate: '2026-11-01',
  admissionTime: '08:00',
  clinicalEpisodeId: `synthetic-episode-${bedId}`,
  pathology: '',
  isBlocked: false,
});

emulator('a replay of a committed edit after another computer saved', () => {
  let app: App;
  let db: Firestore;
  type Handler = { run: (data: unknown, ctx: unknown) => Promise<unknown> };
  let api: {
    patchDailyRecordWithClinicalAuthority: Handler;
    saveDailyRecordWithClinicalAuthority: Handler;
  };
  let date: string;
  const dayRef = () => db.doc(`${root}/dailyRecords/${date}`);
  type StoredDay = {
    lastUpdated: unknown;
    meta: { revision: number };
    beds: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
  const stored = async () => (await dayRef().get()).data() as StoredDay;
  const versionOf = (day: StoredDay) =>
    day.lastUpdated instanceof Timestamp ? day.lastUpdated.toDate().toISOString() : day.lastUpdated;
  /** The request a computer sends for `patch` over the day as it reads it now. */
  const request = async (uid: string, mutationId: string, patch: Record<string, unknown>) => {
    const day = await stored();
    return {
      date,
      patch,
      expectedLastUpdated: versionOf(day),
      mode: 'enforced',
      origin: 'direct_partial_update',
      historyPolicy: 'skip',
      syncContract: {
        mutationId,
        clientId: uid,
        expectedVersion: versionOf(day),
        baseRevision: day.meta.revision,
        changedPaths: Object.keys(patch),
      },
    };
  };
  const patchOn = (uid: string, data: unknown) =>
    api.patchDailyRecordWithClinicalAuthority.run(data, context(uid));

  beforeAll(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST ?? '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
      throw new Error('Only a loopback Firestore emulator is permitted');
    app = initializeApp({ projectId }, 'authority-replay-other-writer');
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: async () => 'nurse_hospital',
    });
  });
  beforeEach(async () => {
    date = getTodayISO();
    for (const doc of await db.collection(`${root}/dailyRecords`).listDocuments())
      await db.recursiveDelete(doc);
    // What production runs since 2026-11-07: the schema-v2 policy with enforced clinical batches.
    await db.doc(`${root}/settings/rayenImportPolicy`).set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
    await dayRef().set({
      date,
      dateTimestamp: Date.now(),
      lastUpdated: new Date(Date.now() - 60_000).toISOString(),
      beds: { R1: patient('R1', '12.345.678-5'), R2: patient('R2', '11.111.111-1') },
      discharges: [],
      transfers: [],
      cma: [],
      nurses: [],
      activeExtraBeds: [],
      meta: { revision: 1 },
    });
  });
  afterAll(async () => {
    await db?.terminate();
    if (app) await deleteApp(app);
  });

  it('confirms the patch without a second write when the other computer saved another bed', async () => {
    const sent = await request('synthetic-A', 'synthetic-A-1', { 'beds.R1.pathology': 'NEUMONIA' });
    await expect(patchOn('synthetic-A', sent)).resolves.toMatchObject({ revision: 2 });
    await expect(
      patchOn(
        'synthetic-B',
        await request('synthetic-B', 'synthetic-B-1', { 'beds.R2.pathology': 'ITU' })
      )
    ).resolves.toMatchObject({ revision: 3 });
    const afterB = await stored();

    const replay = await patchOn('synthetic-A', sent);

    expect(replay).toMatchObject({
      success: true,
      authorityStatus: 'idempotent',
      revision: 3,
      mutationId: 'synthetic-A-1',
      recordState: {
        record: { beds: { R1: { pathology: 'NEUMONIA' }, R2: { pathology: 'ITU' } } },
      },
    });
    expect(await stored()).toEqual(afterB);
  });

  it('confirms the whole-day save the same way', async () => {
    const day = await stored();
    const { meta: _meta, ...rest } = day;
    const record = {
      ...rest,
      beds: { ...day.beds, R1: { ...day.beds.R1, pathology: 'NEUMONIA' } },
    };
    const sent = {
      date,
      record,
      expectedLastUpdated: versionOf(day),
      mode: 'enforced',
      origin: 'outbox',
      syncContract: {
        mutationId: 'synthetic-A-save',
        clientId: 'synthetic-A',
        expectedVersion: versionOf(day),
        baseRevision: 1,
        changedPaths: ['beds.R1.pathology'],
      },
    };
    await expect(
      api.saveDailyRecordWithClinicalAuthority.run(sent, context('synthetic-A'))
    ).resolves.toMatchObject({ revision: 2 });
    await patchOn(
      'synthetic-B',
      await request('synthetic-B', 'synthetic-B-1', { 'beds.R2.pathology': 'ITU' })
    );
    const afterB = await stored();

    await expect(
      api.saveDailyRecordWithClinicalAuthority.run(sent, context('synthetic-A'))
    ).resolves.toMatchObject({ authorityStatus: 'idempotent', revision: 3 });
    expect(await stored()).toEqual(afterB);
  });

  it('does not take the edit as applied when the other computer then wrote the same field', async () => {
    const sent = await request('synthetic-A', 'synthetic-A-1', { 'beds.R1.pathology': 'NEUMONIA' });
    await patchOn('synthetic-A', sent);
    await patchOn(
      'synthetic-B',
      await request('synthetic-B', 'synthetic-B-1', { 'beds.R1.pathology': 'NEUMONIA GRAVE' })
    );
    const afterB = await stored();

    await expect(patchOn('synthetic-A', sent)).rejects.toMatchObject({ code: 'aborted' });
    expect(await stored()).toEqual(afterB);
    expect(afterB.beds.R1.pathology).toBe('NEUMONIA GRAVE');
  });
});
