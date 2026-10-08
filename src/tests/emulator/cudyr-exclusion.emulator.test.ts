import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
const require = createRequire(import.meta.url);
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
describeEmulator('daily CUDYR eligibility decisions', () => {
  let app: App, db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const context = {
    auth: { uid: 'reviewer', token: { email: 'synthetic@example.com', name: 'Revisor' } },
  };
  const request = {
    kind: 'save-daily-exclusion',
    schemaVersion: 1,
    confirmed: true,
    date: '2026-07-02',
    clinicalEpisodeId: 'synthetic-episode',
    expectedRevision: 0,
    operationId: '00000000-0000-4000-8000-000000000001',
    reason: 'not_hospitalized',
    note: 'Salida física verificada.',
  };
  const create = (role = 'nurse_hospital', access = true) =>
    createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => role,
      hasCallableClinicalAccess: async () => access,
    });
  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
      throw new Error('Local emulator required');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-exclusion' }, 'cudyr-exclusion');
    db = getFirestore(app);
    await db.doc(hospital + '/dailyRecords/2026-07-02').set({
      date: '2026-07-02',
      beds: {
        R1: {
          clinicalEpisodeId: request.clinicalEpisodeId,
          patientName: 'Sintético',
          cudyr: 'D3',
        },
      },
    });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  it('requires clinical read access and a permitted writer role', async () => {
    await expect(create().archiveCudyrHistory.run(request, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    for (const role of ['viewer', 'doctor_specialist', 'doctor_urgency', 'editor'])
      await expect(create(role).archiveCudyrHistory.run(request, context)).rejects.toMatchObject({
        code: 'permission-denied',
      });
    await expect(
      create('viewer', false).readCudyrHistory.run(
        { kind: 'daily-exclusions', month: '2026-07' },
        context
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('requires the precise episode in that daily census', async () => {
    await expect(
      create().archiveCudyrHistory.run({ ...request, clinicalEpisodeId: 'other-episode' }, context)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      create().archiveCudyrHistory.run({ ...request, date: '2026-07-03' }, context)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('persists once, rejects stale edits, retains withdrawal audit and never changes patient data', async () => {
    const fns = create();
    const before = (await db.doc(hospital + '/dailyRecords/2026-07-02').get()).data();
    const a = await fns.archiveCudyrHistory.run(
      { ...request, updatedBy: { uid: 'forged' } },
      context
    );
    expect(a.exclusion.updatedBy.uid).toBe(context.auth.uid);
    expect(await fns.archiveCudyrHistory.run(request, context)).toEqual(a);
    await expect(
      fns.archiveCudyrHistory.run({ ...request, note: 'Changed payload' }, context)
    ).rejects.toMatchObject({ code: 'already-exists' });
    const update = {
      ...request,
      reason: null,
      operationId: '00000000-0000-4000-8000-000000000002',
    };
    await expect(fns.archiveCudyrHistory.run(update, context)).rejects.toMatchObject({
      code: 'aborted',
    });
    const b = await fns.archiveCudyrHistory.run({ ...update, expectedRevision: 1 }, context);
    expect(b.exclusion).toMatchObject({ reason: null, revision: 2 });
    const read = await fns.readCudyrHistory.run(
      { kind: 'daily-exclusions', month: '2026-07' },
      context
    );
    expect(read.exclusions).toHaveLength(1);
    expect(read.exclusions[0].reason).toBeNull();
    expect(
      (
        await db
          .collection(hospital + '/cudyrDailyExclusions/' + a.exclusion.id + '/revisions')
          .get()
      ).size
    ).toBe(2);
    expect((await db.doc(hospital + '/dailyRecords/2026-07-02').get()).data()).toEqual(before);
  });
});
