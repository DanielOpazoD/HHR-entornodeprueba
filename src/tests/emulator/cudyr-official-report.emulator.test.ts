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
const { fingerprint } = require('../../../functions/lib/cudyrOfficialReportStore.js');
describeEmulator('official CUDYR monthly artifact', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const month = '2026-08';
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
      throw new Error('Local emulator required.');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-official' }, 'cudyr-official');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  it('approves and publishes once, reads without payload retransmission, and invalidates explicit revisions', async () => {
    const fns = create();
    const report = {
      schemaVersion: 1,
      from: month + '-01',
      to: month + '-31',
      rows: [
        {
          key: 'synthetic-row',
          date: month + '-01',
          clinicalEpisodeId: 'synthetic-episode',
          eligibility: 'elegible',
          verifiedContext: { revision: 1 },
        },
      ],
      observations: [],
      captures: [],
      corrections: [],
      dischargeAudit: [],
      exclusions: [],
      issues: [],
      coverage: Array.from({ length: 31 }, (_, i) => ({
        date: month + '-' + String(i + 1).padStart(2, '0'),
        state: 'disponible',
        reconstructionApproval: { approvedAt: new Date().toISOString() },
      })),
    };
    const reviewRef = db.doc(hospital + '/cudyrVerifiedContexts/' + month);
    // Seed documentary evidence, not the official artifact: exercise real callable publication below.
    await reviewRef.set({
      revision: 1,
      verification: 'reviewed_documentary_context',
      entries: [{ synthetic: true }],
    });
    const approval = {
      kind: 'save-verified-context',
      action: 'approve_census',
      schemaVersion: 1,
      confirmed: true,
      policyVersion: 2,
      month,
      expectedRevision: 1,
      operationId: 'synthetic-approval-operation-01',
      reason: 'Conciliación mensual sintética comprobada.',
      days: report.coverage.map(d => ({
        date: d.date,
        fingerprint: fingerprint(report, d.date),
      })),
    };
    await expect(
      create('doctor_urgency').archiveCudyrHistory.run(approval, context)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(
      await Promise.all([
        fns.archiveCudyrHistory.run(approval, context),
        fns.archiveCudyrHistory.run(approval, context),
      ])
    ).toEqual([
      { persisted: true, revision: 2 },
      { persisted: true, revision: 2 },
    ]);
    report.rows[0].verifiedContext.revision = 2;
    const probe = await fns.readCudyrHistory.run(
      { kind: 'official-report', month, episodes: ['synthetic-episode'] },
      context
    );
    expect(probe.state).toBe('missing');
    const request = {
      kind: 'save-official-report',
      schemaVersion: 1,
      month,
      report,
      sourceVersion: probe.sourceVersion,
    };
    const [first, second] = await Promise.all([
      fns.archiveCudyrHistory.run(request, context),
      fns.archiveCudyrHistory.run(request, context),
    ]);
    expect(first.version).toBe(second.version);
    expect(first.savedAt).toBe(second.savedAt);
    expect(
      (await db.collection(hospital + '/cudyrOfficialReports/' + month + '/versions').get()).size
    ).toBe(1);
    const ready = await fns.readCudyrHistory.run({ kind: 'official-report', month }, context);
    expect(ready.state).toBe('ready');
    expect(ready.report).toBe(first.report);
    const unchanged = await fns.readCudyrHistory.run(
      { kind: 'official-report', month, knownVersion: first.version },
      context
    );
    expect(unchanged.state).toBe('unchanged');
    expect(unchanged.report).toBeUndefined();
    await expect(
      create('doctor_urgency', false).readCudyrHistory.run(
        { kind: 'official-report', month },
        context
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
    // Routine census refresh is not a revision of a closed official month.
    await db.doc(hospital + '/dailyRecords/2026-08-01').set({ synthetic: 'refresh' });
    expect(
      (await fns.readCudyrHistory.run({ kind: 'official-report', month }, context)).state
    ).toBe('ready');
    // Explicit correction of an actual discharge must invalidate the approved artifact.
    const correctionRef = db.doc(hospital + '/cudyrArchiveVersions/dischargeCorrections');
    await correctionRef.set({ synthetic: true });
    expect(
      (await fns.readCudyrHistory.run({ kind: 'official-report', month }, context)).state
    ).toBe('missing');
    await correctionRef.delete();
    expect(
      (await fns.readCudyrHistory.run({ kind: 'official-report', month }, context)).state
    ).toBe('ready');
    // An explicit exception makes the existing snapshot stale and rejects a concurrent old publisher.
    await db
      .doc(hospital + '/cudyrDailyExclusions/synthetic-exception')
      .set({ month, date: month + '-01' });
    const invalidated = await fns.readCudyrHistory.run({ kind: 'official-report', month }, context);
    expect(invalidated.state).toBe('missing');
    expect(invalidated.report).toBeUndefined();
    await expect(fns.archiveCudyrHistory.run(request, context)).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});
