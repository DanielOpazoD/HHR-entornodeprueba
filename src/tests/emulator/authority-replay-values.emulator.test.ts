import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';

// The shipped patch and whole-day handlers with their real admin transactions; synthetic claims and
// data (W20-C3 review probes). After A's edit, another computer saves another bed; then A resends
// the very same request, or sends a correction with the same account, computer and identifier.
// Only a request asking for exactly what is stored is the same edit: text by its characters, a
// number apart from its text, list order, and an absent field apart from `null` (keys of a map in
// another order are the same map).
const require = createRequire(import.meta.url);
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');

const emulator = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
const projectId = 'demo-hhr-authority-replay-values';
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

emulator('the value a resend asks for, after another computer saved another bed', () => {
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
    app = initializeApp({ projectId }, 'authority-replay-values');
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: async (email: string) =>
        email.startsWith('admin') ? 'admin' : 'nurse_hospital',
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

  const ABSENT = Symbol('absent');
  const writer = 'A';
  const edit = 'first-edit';
  const create = async (mode: string, path: string, value: unknown) => {
    const data = await request(writer, edit, { [path]: value });
    if (mode === 'patch') {
      if (value === ABSENT) throw new Error('Use a full save to omit a field');
      return () => patchOn(writer, data);
    }
    const { meta: _meta, ...day } = await stored();
    const parts = path.split('.');
    let parent: Record<string, unknown> = day;
    for (const segment of parts.slice(0, -1))
      parent = (parent[segment] ??= {}) as Record<string, unknown>;
    const key = parts.at(-1)!;
    if (value === ABSENT) delete parent[key];
    else parent[key] = value;
    const { patch: _patch, ...args } = data;
    return () =>
      api.saveDailyRecordWithClinicalAuthority.run({ ...args, record: day }, context(writer));
  };
  type Answer = { authorityStatus?: string; revision?: number };
  const answerOf = async (send: () => Promise<unknown>): Promise<Answer> => {
    try {
      return (await send()) as Answer;
    } catch (error) {
      return { authorityStatus: (error as { code?: string }).code };
    }
  };
  const valueAt = (day: unknown, path: string) =>
    path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], day);
  const otherBed = async () => {
    const data = await request('B', 'another-edit', { 'beds.R2.pathology': 'OTRA CAMA' });
    await expect(patchOn('B', data)).resolves.toMatchObject({ authorityStatus: 'ok', revision: 3 });
  };
  const cases: Array<[string, string, unknown, unknown]> = [
    ['espacio final', 'beds.R1.pathology', 'DIAGNOSTICO', 'DIAGNOSTICO '],
    ['mayusculas', 'beds.R1.pathology', 'DX', 'dx'],
    ['numero como texto', 'beds.R1.age', 40, '40'],
    ['orden de la lista', 'beds.R1.devices', ['VVP', 'SNG'], ['SNG', 'VVP']],
    [
      'claves reordenadas',
      'beds.R1.deviceDetails',
      { VVP: { installationDate: '2026-11-01' }, SNG: {} },
      { SNG: {}, VVP: { installationDate: '2026-11-01' } },
    ],
    ['espacio identico', 'beds.R1.pathology', ' DX ', ' DX '],
    ['null identico', 'beds.R1.blockedReason', null, null],
    ['numero identico', 'beds.R1.age', 40, 40],
  ];
  const same = ['claves reordenadas', 'espacio identico', 'null identico', 'numero identico'];
  for (const mode of ['patch', 'full']) {
    it.each(cases)(`${mode}: tells or credits %s`, async (name, path, first, second) => {
      // A whole-day save records absent → null as no change; start from another value.
      if (first === null) await dayRef().update({ [path]: 'ANTES' });
      const initial = await create(mode, path, first);
      await expect(initial()).resolves.toMatchObject({ authorityStatus: 'ok', revision: 2 });
      await otherBed();
      const before = await stored();
      // An identical value resends the exact request; a reordered map and every correction are
      // sent from the current base.
      const next =
        same.includes(name) && name !== 'claves reordenadas'
          ? initial
          : await create(mode, path, second);
      const result = await answerOf(next);
      const after = await stored();
      if (same.includes(name)) {
        expect(result).toMatchObject({ authorityStatus: 'idempotent', revision: 3 });
        expect(after).toEqual(before);
      } else {
        expect(result).toMatchObject({ authorityStatus: 'ok', revision: 4 });
        expect(valueAt(after, path)).toEqual(second);
      }
    });
  }

  const checklist = 'handoffDayChecklist.escalaBraden';
  const field = 'beds.R1.blockedReason';
  const presenceCases = [
    ['full', 'full', checklist, null, ABSENT],
    ['full', 'full', checklist, ABSENT, null],
    ['full', 'patch', field, ABSENT, null],
    ['patch', 'full', field, null, ABSENT],
    ['full', 'full', checklist, ABSENT, ABSENT],
  ] as const;
  it.each(presenceCases)(
    'presence: %s, then %s, %s: %s → %s',
    async (origin, mode, path, first, second) => {
      await dayRef().update({ [path]: path === checklist ? true : 'ANTES' });
      const initial = await create(origin, path, first);
      await expect(initial()).resolves.toMatchObject({ authorityStatus: 'ok', revision: 2 });
      await otherBed();
      const before = await stored();
      // An exact resend has its original base; a different request has the current base.
      const result = await answerOf(first === second ? initial : await create(mode, path, second));
      const after = await stored();
      const parts = path.split('.');
      const parent = valueAt(after, parts.slice(0, -1).join('.')) as Record<string, unknown>;
      const present = Object.hasOwn(parent, parts.at(-1)!);
      if (first === second) {
        expect(result).toMatchObject({ authorityStatus: 'idempotent', revision: 3 });
        expect(after).toEqual(before);
      } else {
        expect({ status: result.authorityStatus, revision: after.meta.revision, present }).toEqual({
          status: 'ok',
          revision: 4,
          present: second !== ABSENT,
        });
        if (second !== ABSENT) expect(parent[parts.at(-1)!]).toBeNull();
      }
    }
  );
});
