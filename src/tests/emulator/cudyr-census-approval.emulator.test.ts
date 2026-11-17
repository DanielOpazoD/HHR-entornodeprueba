import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
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
describeEmulator('approval of a month that needed no documentary reconciliation', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const month = '2026-09';
  const context = {
    auth: {
      uid: 'synthetic-reviewer',
      token: { email: 'synthetic@example.com', name: 'Revisor sintético' },
    },
  };
  const fns = () =>
    createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'nurse_hospital',
      hasCallableClinicalAccess: async () => true,
    });
  const approval = (operationId: string, expectedRevision = 0) => ({
    kind: 'save-verified-context',
    action: 'approve_census',
    schemaVersion: 1,
    confirmed: true,
    policyVersion: 2,
    month,
    expectedRevision,
    operationId,
    reason: 'Censo del mes completo y verificado sin conciliación.',
    days: Array.from({ length: 30 }, (_, i) => ({
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
      fingerprint: 'b'.repeat(64),
    })),
  });
  const read = async () =>
    (await fns().readCudyrHistory.run({ kind: 'verified-context', month }, context)).review;
  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
      throw new Error('Local emulator required.');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-census-approval' }, 'cudyr-census-approval');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  it('creates revision 1 with the approval, rejects a racing approval and reopens on a later reconciliation', async () => {
    expect(await read()).toBeNull();
    const [first, second] = await Promise.allSettled([
      fns().archiveCudyrHistory.run(approval('synthetic-approval-race-01'), context),
      fns().archiveCudyrHistory.run(approval('synthetic-approval-race-02'), context),
    ]);
    const outcomes = [first, second].map(r => r.status).sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const won = [first, second].find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{
      revision: number;
    }>;
    const lost = [first, second].find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(won.value).toEqual({ persisted: true, revision: 1 });
    expect(lost.reason).toMatchObject({ code: 'aborted' });

    const created = await read();
    expect(created).toMatchObject({
      schemaVersion: 1,
      month,
      revision: 1,
      entries: [],
      files: [],
      reconstructedDays: [],
      verification: 'census_approval_only',
      reviewedBy: { uid: context.auth.uid },
      censusApproval: {
        policyVersion: 2,
        reason: 'Censo del mes completo y verificado sin conciliación.',
        approvedBy: { uid: context.auth.uid },
      },
    });
    expect(created.censusApproval.days).toHaveLength(30);
    expect(
      (await db.collection(`${hospital}/cudyrVerifiedContexts/${month}/revisions`).get()).size
    ).toBe(1);

    // A re-approval after the month changed keeps the document honest about its origin.
    expect(
      await fns().archiveCudyrHistory.run(approval('synthetic-approval-again-01', 1), context)
    ).toEqual({ persisted: true, revision: 2 });
    expect(await read()).toMatchObject({ revision: 2, verification: 'census_approval_only' });

    // A later documentary save replaces the document without the approval: the month reopens.
    await fns().archiveCudyrHistory.run(
      {
        kind: 'save-verified-context',
        schemaVersion: 1,
        confirmed: true,
        month,
        action: 'withdraw',
        reason: 'Conciliación posterior sintética del mes aprobado.',
        expectedRevision: 2,
        operationId: 'synthetic-context-after-approval',
        entries: [],
        files: [],
        reconstructedDays: [],
      },
      context
    );
    const reopened = await read();
    expect(reopened).toMatchObject({ revision: 3, verification: 'reviewed_documentary_context' });
    expect(reopened).not.toHaveProperty('censusApproval');
  });
});
