import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { createCudyrHistoryFunctions } = require('../../../functions/lib/cudyrHistoryFunctions.js');
const { dischargeKey } = require('../../../functions/lib/cudyrDischargeContract.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
describeEmulator('actual discharge authority and immutable audit', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const authorityDate = '2026-02-20';
  const episode = 'synthetic-discharge-episode';
  const context = {
    auth: {
      uid: 'synthetic-editor',
      token: { email: 'synthetic@example.com', name: 'Usuario sintético' },
    },
  };
  const request = {
    kind: 'correct-discharge',
    schemaVersion: 1,
    operationId: '00000000-0000-4000-8000-000000000001',
    authorityDate,
    clinicalEpisodeId: episode,
    expectedRevision: 0,
    actualDischarge: { date: '2026-02-19', time: '11:30', timeZone: 'Pacific/Easter' },
    reason: 'Salida física verificada en prueba sintética.',
    confirmed: true,
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
    app = initializeApp({ projectId: 'demo-hhr-cudyr-discharge' }, 'cudyr-discharge');
    db = getFirestore(app);
    await db.doc(hospital + '/dailyRecords/' + authorityDate).set({
      date: authorityDate,
      beds: {},
      discharges: [
        {
          id: 'synthetic-movement',
          clinicalEpisodeId: episode,
          patientName: 'Paciente sintético',
          rut: 'synthetic-document',
          bedId: 'R1',
          movementDate: '2026-02-20',
          time: '18:30',
          movementProvenance: {
            source: 'gestion_camas',
            lineageId: 'synthetic-lineage',
            classifiedAt: '2026-02-20T23:35:00Z',
          },
          originalData: {
            clinicalEpisodeId: episode,
            admissionDate: '2026-02-18',
            admissionTime: '10:00',
          },
        },
      ],
    });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  it('rejects unauthenticated, non-clinical and clinical read-only users on correction and history dispatch', async () => {
    await expect(create().archiveCudyrHistory.run(request, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    for (const role of ['viewer', 'doctor_specialist', 'doctor_urgency', 'editor']) {
      await expect(create(role).archiveCudyrHistory.run(request, context)).rejects.toMatchObject({
        code: 'permission-denied',
      });
    }
    for (const data of [
      { kind: 'discharge-corrections', clinicalEpisodeIds: [episode] },
      { kind: 'discharge-audit', clinicalEpisodeId: episode },
    ]) {
      await expect(create().readCudyrHistory.run(data, {})).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      await expect(
        create('viewer', false).readCudyrHistory.run(data, context)
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect((await db.collection(hospital + '/cudyrDischargeCorrections').get()).size).toBe(0);
  });
  it('concurrently retries one correction once and preserves source egreso, census and actor authority', async () => {
    const before = (await db.doc(hospital + '/dailyRecords/' + authorityDate).get()).data();
    const fns = create();
    const results = await Promise.all([
      fns.archiveCudyrHistory.run(request, context),
      fns.archiveCudyrHistory.run(request, context),
    ]);
    expect(results.map(r => r.correction.revision)).toEqual([1, 1]);
    expect(results[0].correction.updatedBy).toEqual({
      uid: context.auth.uid,
      email: context.auth.token.email,
      name: context.auth.token.name,
      role: 'nurse_hospital',
    });
    expect(results[0].correction.sourceContexts[0]).toMatchObject({
      movementDate: '2026-02-20',
      movementTime: '18:30',
    });
    expect((await db.doc(hospital + '/dailyRecords/' + authorityDate).get()).data()).toEqual(
      before
    );
    expect((await db.collection(hospital + '/cudyrDischargeAudit').get()).size).toBe(1);
  });
  it('serializes competing corrections and rejects a stale browser revision', async () => {
    const fns = create('admin');
    const replies = await Promise.allSettled(
      [2, 3].map(index =>
        fns.archiveCudyrHistory.run(
          {
            ...request,
            operationId: '00000000-0000-4000-8000-00000000000' + index,
            expectedRevision: 1,
            actualDischarge: { ...request.actualDischarge, time: index === 2 ? '12:00' : '13:00' },
          },
          context
        )
      )
    );
    expect(replies.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(replies.find(r => r.status === 'rejected')).toMatchObject({
      reason: { code: 'aborted' },
    });
    const current = (
      await db.doc(hospital + '/cudyrDischargeCorrections/' + dischargeKey(episode)).get()
    ).data();
    expect(current?.revision).toBe(2);
    const audit = await fns.readCudyrHistory.run(
      { kind: 'discharge-audit', clinicalEpisodeId: episode, limit: 1 },
      context
    );
    expect(audit.entries).toHaveLength(1);
    expect(audit.nextCursor).toBeTruthy();
    expect(audit.entries[0]).not.toHaveProperty('request');
    const next = await fns.readCudyrHistory.run(
      { kind: 'discharge-audit', clinicalEpisodeId: episode, limit: 1, cursor: audit.nextCursor },
      context
    );
    expect(next.entries).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    const read = await fns.readCudyrHistory.run(
      { kind: 'discharge-corrections', clinicalEpisodeIds: [episode] },
      context
    );
    expect(read.corrections[0].revision).toBe(2);
    expect(
      (
        await fns.readCudyrHistory.run(
          { kind: 'discharge-audit', clinicalEpisodeId: 'another-episode' },
          context
        )
      ).entries
    ).toHaveLength(0);
  });
  it('rejects an absent episode and a cross-hospital override without writing', async () => {
    const fns = create();
    await expect(
      fns.archiveCudyrHistory.run({ ...request, clinicalEpisodeId: 'absent' }, context)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      fns.archiveCudyrHistory.run({ ...request, hospitalId: 'other' }, context)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await db.collection(hospital + '/cudyrDischargeAudit').get()).size).toBe(2);
  });
});
