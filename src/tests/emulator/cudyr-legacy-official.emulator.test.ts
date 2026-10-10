import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
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
const { readOfficialReport } = require('../../../functions/lib/cudyrOfficialReportStore.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;

describeEmulator('official CUDYR saved before discharge revision markers', () => {
  let app: App;
  let db: Firestore;
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
      throw new Error('Local emulator required.');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-legacy' }, 'cudyr-legacy');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it('reads the original approved artifact without rewriting, but refuses documentary and correction changes', async () => {
    const hospital = db.doc('hospitals/hanga_roa');
    const month = '2026-06';
    const reviewRef = hospital.collection('cudyrVerifiedContexts').doc(month);
    await reviewRef.set({ synthetic: 'approved' });
    const review = await reviewRef.get();
    const sourceVersion = createHash('sha256')
      .update(
        JSON.stringify([
          2,
          [[reviewRef.path, `${review.updateTime!.seconds}:${review.updateTime!.nanoseconds}`]],
        ])
      )
      .digest('hex');
    const ref = hospital.collection('cudyrOfficialReports').doc(month);
    await ref.set({
      policyVersion: 2,
      sourceVersion,
      version: 'synthetic-artifact',
      episodes: ['synthetic-episode'],
      savedAt: '2026-10-08T12:00:00Z',
      encoding: 'gzip-base64',
      report: 'synthetic-original-payload',
    });
    const before = await ref.get();
    const ready = await readOfficialReport(hospital, { month });
    expect(ready).toMatchObject({
      state: 'ready',
      sourceVersion,
      report: 'synthetic-original-payload',
    });
    expect(
      await readOfficialReport(hospital, { month, knownVersion: ready.version })
    ).toMatchObject({ state: 'unchanged' });
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);

    // Unrelated new episode markers do not affect the archived month.
    await hospital
      .collection('cudyrArchiveVersions')
      .doc('unrelated')
      .set({ clinicalEpisodeId: 'synthetic-other' });
    expect((await readOfficialReport(hospital, { month })).state).toBe('ready');
    await hospital
      .collection('cudyrArchiveVersions')
      .doc('relevant')
      .set({ clinicalEpisodeId: 'synthetic-episode' });
    const changed = await readOfficialReport(hospital, { month });
    expect(changed.state).toBe('missing');
    expect(changed.report).toBeUndefined();

    // A legacy global writer must also invalidate a pre-marker artifact.
    const oldWriter = hospital.collection('cudyrArchiveVersions').doc('dischargeCorrections');
    await oldWriter.set({ synthetic: 'old-writer-revision' });
    expect((await readOfficialReport(hospital, { month })).state).toBe('missing');
    // A different source fingerprint never receives this compatibility treatment.
    await reviewRef.set({ synthetic: 'changed-documentary-review' });
    expect((await readOfficialReport(hospital, { month })).state).toBe('missing');
    expect((await ref.get()).data()).toEqual(before.data());
  });
});
