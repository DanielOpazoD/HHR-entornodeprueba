import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
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
describeEmulator('verified documentary context archive', () => {
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
    app = initializeApp({ projectId: 'demo-hhr-cudyr-verified-context' }, 'cudyr-verified-context');
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
  const request = (reportId: string) => {
    const bytes = Buffer.from(JSON.stringify({ kind: 'synthetic discharge evidence' }));
    return {
      kind: 'save-verified-context',
      schemaVersion: 1,
      confirmed: true,
      month: '2026-10',
      action: 'replace',
      reason: 'Conciliación documental de episodio sintético.',
      expectedRevision: 0,
      operationId: 'synthetic-context-operation-01',
      files: [{ name: 'evidence.json', base64: bytes.toString('base64') }],
      entries: [
        {
          date: '2026-10-02',
          reportId,
          sourceRow: 5,
          clinicalEpisodeId: '123',
          admissionAt: '2026-10-01T14:00:00-05:00',
          dischargeAt: '2026-10-04T14:00:00-05:00',
          group: 'intermedia',
          modality: 'hospitalizacion',
          bedId: 'R1',
          bedName: 'R1',
          document: 'ID-TEST',
          documentType: 'Otro',
          basis: 'reviewed_documentary_context',
          reason: 'Contexto de ingreso documentado por responsable autorizado.',
          evidenceHashes: [createHash('sha256').update(bytes).digest('hex')],
        },
      ],
    };
  };
  it('enforces clinical roles before accepting documentary corrections', async () => {
    await expect(
      create().archiveCudyrHistory.run(request('a'.repeat(64)), {})
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      create('doctor_urgency').archiveCudyrHistory.run(request('a'.repeat(64)), context)
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('retries idempotently, rejects stale edits and preserves withdrawal audit without changing original census', async () => {
    const fns = create();
    const source = {
      ...supplementRequest(),
      capture: { source: 'extension_monthly_report', observedAt: new Date().toISOString() },
    };
    const imported = await fns.archiveCudyrHistory.run(source, context);
    const data = request(imported.id);
    const before = (await db.doc(hospital + '/dailyRecords/2026-10-01').get()).data();
    const replies = await Promise.all([
      fns.archiveCudyrHistory.run(data, context),
      fns.archiveCudyrHistory.run(data, context),
    ]);
    expect(replies).toEqual([
      { persisted: true, revision: 1 },
      { persisted: true, revision: 1 },
    ]);
    await expect(
      fns.archiveCudyrHistory.run(
        { ...data, operationId: 'synthetic-context-operation-02' },
        context
      )
    ).rejects.toMatchObject({ code: 'aborted' });
    const saved = await fns.readCudyrHistory.run(
      { kind: 'verified-context', month: '2026-10' },
      context
    );
    expect(saved.review).toMatchObject({
      revision: 1,
      entries: data.entries,
      reviewedBy: { uid: context.auth.uid },
    });
    expect(saved.review.files[0]).not.toHaveProperty('base64');
    await fns.archiveCudyrHistory.run(
      {
        ...data,
        action: 'withdraw',
        expectedRevision: 1,
        operationId: 'synthetic-context-operation-03',
        entries: [],
        files: [],
        reconstructedDays: [],
      },
      context
    );
    const withdrawn = await fns.readCudyrHistory.run(
      { kind: 'verified-context', month: '2026-10' },
      context
    );
    expect(withdrawn.review).toMatchObject({ revision: 2, entries: [] });
    expect(
      (await db.collection(hospital + '/cudyrVerifiedContexts/2026-10/revisions').get()).size
    ).toBe(2);
    expect((await db.doc(hospital + '/dailyRecords/2026-10-01').get()).data()).toEqual(before);
    expect((await db.collection(hospital + '/cudyrHistory').get()).empty).toBe(true);
  });
});
