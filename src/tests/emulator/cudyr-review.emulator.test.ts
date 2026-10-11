import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { reviewRequest } from '@/tests/fixtures/cudyrReviewFixture';
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
describeEmulator('persistent documentary reviews', () => {
  let app: App, db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const context = {
    auth: {
      uid: 'synthetic-reviewer',
      token: { email: 'synthetic@example.com', name: 'Revisor sintético' },
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
      throw new Error('Local emulator required');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-review' }, 'cudyr-review');
    db = getFirestore(app);
    await db
      .doc(hospital + '/dailyRecords/2026-07-02')
      .set({ date: '2026-07-02', beds: { R1: { patientName: 'Sintético', cudyr: 'D3' } } });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  it('requires authenticated authorized roles and ignores supplied reviewer identity', async () => {
    await expect(create().archiveCudyrHistory.run(reviewRequest(), {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    for (const role of ['viewer', 'doctor_specialist', 'doctor_urgency', 'editor'])
      await expect(
        create(role).archiveCudyrHistory.run(reviewRequest(), context)
      ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      create('viewer', false).readCudyrHistory.run(
        { kind: 'monthly-reviews', month: '2026-07' },
        context
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('retries idempotently and leaves census, evaluations, discharges and supplements unchanged', async () => {
    const before = (await db.doc(hospital + '/dailyRecords/2026-07-02').get()).data();
    const fns = create();
    const request = { ...reviewRequest(), reviewedBy: { uid: 'forged' } };
    const [a, b] = await Promise.all([
      fns.archiveCudyrHistory.run(request, context),
      fns.archiveCudyrHistory.run(request, context),
    ]);
    expect(a).toEqual(b);
    expect(a.review.revision).toBe(1);
    expect(a.review.reviewedBy.uid).toBe(context.auth.uid);
    expect(a.review.updatedAt).toMatch(/^\d{4}-/);
    expect((await db.doc(hospital + '/dailyRecords/2026-07-02').get()).data()).toEqual(before);
    for (const collection of [
      'cudyrHistory',
      'cudyrCaptures',
      'cudyrDischargeCorrections',
      'cudyrMonthlySupplements',
    ])
      expect((await db.collection(hospital + '/' + collection).get()).empty).toBe(true);
    await expect(
      fns.archiveCudyrHistory.run(
        { ...request, decision: { ...request.decision, reason: 'Different request content' } },
        context
      )
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('rejects stale concurrent edits and preserves both revisions for audit and reopening', async () => {
    const fns = create(),
      request = reviewRequest();
    const update = {
      ...request,
      expectedRevision: 1,
      operationId: 'synthetic-operation-0002',
      decision: {
        action: 'exclude',
        episodeId: '',
        reason: 'Fuente revisada sin vínculo confirmado',
      },
    };
    const result = await fns.archiveCudyrHistory.run(update, context);
    expect(result.review.revision).toBe(2);
    await expect(
      fns.archiveCudyrHistory.run({ ...update, operationId: 'synthetic-operation-0003' }, context)
    ).rejects.toMatchObject({ code: 'aborted' });
    const restored = await fns.readCudyrHistory.run(
      { kind: 'monthly-reviews', month: '2026-07' },
      context
    );
    expect(restored.reviews[0]).toEqual(result.review);
    const query = {
      kind: 'monthly-reviews',
      month: '2026-07',
      reviewId: result.review.id,
      limit: 1,
    };
    const first = await fns.readCudyrHistory.run(query, context);
    const second = await fns.readCudyrHistory.run({ ...query, cursor: first.nextCursor }, context);
    expect([first.reviews[0].revision, second.reviews[0].revision].sort()).toEqual([1, 2]);
    expect(second.nextCursor).toBeNull();
    expect(
      (await fns.readCudyrHistory.run({ kind: 'monthly-reviews', month: '2026-08' }, context))
        .reviews
    ).toEqual([]);
  });
  it('rejects malformed requests without writes', async () => {
    const fns = create();
    for (const change of [
      { hospitalId: 'other' },
      { confirmed: false },
      { month: '2026-13' },
      { expectedRevision: -1 },
      { entryKey: 'hhr:1' },
      { evidence: { ...reviewRequest().evidence, sources: [] } },
      { evidence: { ...reviewRequest().evidence, contextHash: 'bad' } },
    ])
      await expect(
        fns.archiveCudyrHistory.run({ ...reviewRequest(), ...change }, context)
      ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
