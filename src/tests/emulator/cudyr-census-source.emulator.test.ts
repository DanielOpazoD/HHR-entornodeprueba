import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { utils, write } from 'xlsx';
const require = createRequire(import.meta.url);
// Use the same Admin SDK instance as the callable implementation after separate npm installs.
const requireFunctions = createRequire(new URL('../../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions(
  'firebase-admin/app'
) as typeof import('firebase-admin/app');
const { getFirestore } = requireFunctions(
  'firebase-admin/firestore'
) as typeof import('firebase-admin/firestore');
const { createCudyrHistoryFunctions } = require('../../../functions/lib/cudyrHistoryFunctions.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
describeEmulator('daily source archive', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const context = {
    auth: {
      uid: 'synthetic-importer',
      token: { email: 'synthetic@example.com', name: 'Importador sintético' },
    },
  };
  const create = (role = 'nurse_hospital', access = true) =>
    createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => role,
      hasCallableClinicalAccess: async () => access,
    });
  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
      throw new Error('Local emulator required.');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-census-source' }, 'cudyr-census-source');
    db = getFirestore(app);
    await db.doc(hospital + '/dailyRecords/2026-10-01').set({
      date: '2026-10-01',
      beds: { R1: { patientName: 'Paciente sintético', cudyr: 'D3' } },
    });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  const request = () => {
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ['CENSO DIARIO DE PACIENTES'],
        ['Fecha: 01-08-2026'],
        ['N°', 'NOMBRES Y APELLIDOS', 'ALTA', 'TRASLADO', 'FALLECIDO'],
        [1, 'Paciente sintético', 'NO', 'NO', 'NO'],
      ]),
      'Censo'
    );
    return {
      kind: 'import-daily-census-source',
      confirmed: true,
      observedAt: '2026-09-02T18:00:00Z',
      base64: write(book, { bookType: 'biff8', type: 'base64' }),
      source: {
        date: '2026-08-01',
        patients: [
          { name: 'Paciente sintético', discharged: false, transferred: false, deceased: false },
        ],
      },
    };
  };
  it('rejects unauthorized writes and reads without creating evidence', async () => {
    await expect(create().archiveCudyrHistory.run(request(), {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      create('doctor_urgency').archiveCudyrHistory.run(request(), context)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      create('viewer', false).readCudyrHistory.run(
        { kind: 'daily-census-sources', month: '2026-08' },
        context
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection(hospital + '/cudyrCensusSources').get()).size).toBe(0);
  });
  it('acknowledges concurrent retries once and reads verified bytes without changing the census', async () => {
    const fns = create(),
      data = request();
    const before = (await db.doc(hospital + '/dailyRecords/2026-10-01').get()).data();
    const results = await Promise.all([
      fns.archiveCudyrHistory.run(data, context),
      fns.archiveCudyrHistory.run(data, context),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].persisted).toBe(true);
    expect((await db.collection(hospital + '/cudyrCensusSources').get()).size).toBe(1);
    expect((await db.collection(hospital + '/cudyrSupplementFiles').get()).size).toBe(1);
    const read = await fns.readCudyrHistory.run(
      { kind: 'daily-census-sources', month: '2026-08' },
      context
    );
    expect(read.reports[0]).toMatchObject({
      source: data.source,
      importedBy: { uid: context.auth.uid },
    });
    expect(read.nextCursor).toBeNull();
    expect((await db.doc(hospital + '/dailyRecords/2026-10-01').get()).data()).toEqual(before);
    await db.doc(hospital + '/cudyrSupplementFiles/' + read.reports[0].fileHash).delete();
    await expect(
      fns.readCudyrHistory.run({ kind: 'daily-census-sources', month: '2026-08' }, context)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
