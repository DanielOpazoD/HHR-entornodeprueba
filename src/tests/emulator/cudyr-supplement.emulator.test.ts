import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
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
describeEmulator('passive monthly supplement archive', () => {
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
    app = initializeApp({ projectId: 'demo-hhr-cudyr-supplement' }, 'cudyr-supplement');
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
  it('enforces session and role on import and clinical access on reading', async () => {
    await expect(create().archiveCudyrHistory.run(supplementRequest(), {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    for (const role of ['viewer', 'doctor_specialist', 'doctor_urgency', 'editor'])
      await expect(
        create(role).archiveCudyrHistory.run(supplementRequest(), context)
      ).rejects.toMatchObject({ code: 'permission-denied' });
    const query = { kind: 'monthly-supplements', month: '2026-10' };
    await expect(create().readCudyrHistory.run(query, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      create('viewer', false).readCudyrHistory.run(query, context)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.collection(hospital + '/cudyrMonthlySupplements').get()).size).toBe(0);
  });
  it('concurrent retry creates one immutable version/file/receipt without altering census or clinical history', async () => {
    const before = (await db.doc(hospital + '/dailyRecords/2026-10-01').get()).data();
    const fns = create();
    const r = supplementRequest();
    const results = await Promise.all([
      fns.archiveCudyrHistory.run(r, context),
      fns.archiveCudyrHistory.run(r, context),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].persisted).toBe(true);
    for (const collection of [
      'cudyrMonthlySupplements',
      'cudyrSupplementFiles',
      'cudyrSupplementImports',
    ])
      expect((await db.collection(hospital + '/' + collection).get()).size).toBe(1);
    for (const collection of ['cudyrHistory', 'cudyrCaptures', 'cudyrDischargeCorrections'])
      expect((await db.collection(hospital + '/' + collection).get()).size).toBe(0);
    expect((await db.doc(hospital + '/dailyRecords/2026-10-01').get()).data()).toEqual(before);
    const read = await fns.readCudyrHistory.run(
      { kind: 'monthly-supplements', month: '2026-10' },
      context
    );
    expect(read.reports[0]).toMatchObject({
      verification: 'user_imported',
      importedBy: { uid: context.auth.uid, role: 'nurse_hospital' },
      report: r.report,
    });
    expect(read.reports[0].file).not.toHaveProperty('base64');
    await expect(
      fns.archiveCudyrHistory.run({ ...r, file: { ...r.file, name: 'another.xls' } }, context)
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('preserves original versions, deduplicates exact content and paginates month-specific evidence', async () => {
    const fns = create('admin');
    const r = supplementRequest();
    r.operationId = '00000000-0000-4000-8000-000000000002';
    const duplicate = await fns.archiveCudyrHistory.run(r, context);
    expect(duplicate.status).toBe('already-recorded');
    r.operationId = '00000000-0000-4000-8000-000000000003';
    r.report.generatedLabel = 'Later printing';
    const later = await fns.archiveCudyrHistory.run(r, context);
    expect(later.contentId).toBe(duplicate.contentId);
    expect(later.id).not.toBe(duplicate.id);
    const query = { kind: 'monthly-supplements', month: '2026-10', limit: 1 };
    const first = await fns.readCudyrHistory.run(query, context);
    const second = await fns.readCudyrHistory.run({ ...query, cursor: first.nextCursor }, context);
    expect(first.reports).toHaveLength(1);
    expect(second.reports).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(first.reports[0].id).not.toBe(second.reports[0].id);
    expect(
      (await fns.readCudyrHistory.run({ ...query, month: '2026-09' }, context)).reports
    ).toEqual([]);
    for (const invalid of [
      { hospitalId: 'other' },
      { limit: 100 },
      { cursor: 'bad' },
      { month: '2026-13' },
    ])
      await expect(
        fns.readCudyrHistory.run({ ...query, ...invalid }, context)
      ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
