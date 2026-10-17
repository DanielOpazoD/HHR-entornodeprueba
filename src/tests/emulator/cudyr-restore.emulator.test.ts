import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const requireFunctions = createRequire(new URL('../../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getFirestore } = requireFunctions('firebase-admin/firestore');
const {
  sourceVersion,
  readOfficialReport,
} = require('../../../functions/lib/cudyrOfficialReportStore');
const { attestOfficialRestore, digest } = require('../../../functions/lib/cudyrOfficialRestore');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;

describeEmulator('official artifact after Firestore metadata regeneration', () => {
  let app: App;
  let source: Firestore;
  let restored: Firestore;
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
      throw new Error('Local emulator required.');
    app = initializeApp({ projectId: 'hhr-pruebas' }, 'synthetic-cudyr-restore');
    source = getFirestore(app);
    restored = getFirestore(app, 'migration-restore-20261016-abcdef01');
  });
  afterAll(async () => {
    if (source) await source.terminate();
    if (restored) await restored.terminate();
    if (app) await deleteApp(app);
  });
  const seed = async (month: string) => {
    const sourceHospital = source.doc('hospitals/hanga_roa');
    const restoredHospital = restored.doc(sourceHospital.path);
    const path = 'cudyrVerifiedContexts/' + month;
    await sourceHospital.collection('cudyrVerifiedContexts').doc(month).set({ synthetic: month });
    await restoredHospital.collection('cudyrVerifiedContexts').doc(month).set({ synthetic: month });
    const snapshot = {
      schemaVersion: 1,
      policyVersion: 2,
      month,
      sourceVersion: await sourceVersion(sourceHospital, month),
      version: 'synthetic-original-' + month,
      episodes: [],
      savedAt: '2026-10-08T12:00:00Z',
      encoding: 'gzip-base64',
      report: 'synthetic-payload-' + month,
    };
    await sourceHospital.collection('cudyrOfficialReports').doc(month).set(snapshot);
    await restoredHospital.collection('cudyrOfficialReports').doc(month).set(snapshot);
    return { sourceHospital, restoredHospital, snapshot, path, month };
  };
  it('preserves the artifact, binds verified sources and still invalidates later documentary edits', async () => {
    const args = await seed('2026-08');
    const ref = args.restoredHospital.collection('cudyrOfficialReports').doc(args.month);
    const before = await ref.get();
    expect((await readOfficialReport(args.restoredHospital, args)).state).toBe('missing');
    expect(await attestOfficialRestore(args)).toMatchObject({ verified: true, created: true });
    const ready = await readOfficialReport(args.restoredHospital, args);
    expect(ready).toMatchObject({
      state: 'ready',
      report: args.snapshot.report,
      version: args.snapshot.version,
    });
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect((await ref.get()).data()).toEqual(before.data());
    // A real edit followed by a revert must still invalidate the old metadata binding.
    await restored
      .doc(args.restoredHospital.path + '/' + args.path)
      .set({ synthetic: 'temporary-change' });
    await restored.doc(args.restoredHospital.path + '/' + args.path).set({ synthetic: args.month });
    expect((await readOfficialReport(args.restoredHospital, args)).state).toBe('missing');
    await restored.doc(args.restoredHospital.path + '/' + args.path).set({ synthetic: 'changed' });
    await expect(attestOfficialRestore(args)).rejects.toThrow('restore_sources_mismatch');
  });
  it('refuses a changed artifact or stale source without creating an attestation', async () => {
    const args = await seed('2026-09');
    const ref = args.restoredHospital.collection('cudyrOfficialReports').doc(args.month);
    await ref.update({ report: 'different-content' });
    await expect(attestOfficialRestore(args)).rejects.toThrow('restore_artifact_mismatch');
    await ref.set(args.snapshot);
    await source.doc(args.sourceHospital.path + '/' + args.path).update({ synthetic: 'changed' });
    await expect(attestOfficialRestore(args)).rejects.toThrow('restore_source_not_official');
    expect((await ref.collection('restorations').get()).empty).toBe(true);
    expect((await readOfficialReport(args.restoredHospital, args)).state).toBe('missing');
  });
  it('rejects numeric type differences that decoded data() would hide', async () => {
    const args = await seed('2026-07');
    const sourceRef = source.doc(args.sourceHospital.path + '/' + args.path);
    const restoredRef = restored.doc(args.restoredHospital.path + '/' + args.path);
    await sourceRef.set({ synthetic: args.month, count: 0 });
    await restoredRef.set({ synthetic: args.month, count: -0 });
    const snapshot = {
      ...args.snapshot,
      sourceVersion: await sourceVersion(args.sourceHospital, args.month),
    };
    await args.sourceHospital.collection('cudyrOfficialReports').doc(args.month).set(snapshot);
    await args.restoredHospital.collection('cudyrOfficialReports').doc(args.month).set(snapshot);
    await expect(attestOfficialRestore(args)).rejects.toThrow('restore_sources_mismatch');
  });
  it('never allows the live default database as a restoration destination', async () => {
    const hospital = source.doc('hospitals/hanga_roa');
    await expect(
      attestOfficialRestore({
        sourceHospital: hospital,
        restoredHospital: hospital,
        month: '2026-08',
      })
    ).rejects.toThrow('restore_destination_not_allowed');
  });
});

it('canonical content hashing preserves missing fields, types, array order and map equality', () => {
  expect(digest({ b: false, a: [1, '1'] })).toBe(digest({ a: [1, '1'], b: false }));
  expect(digest({ a: [1, '1'] })).not.toBe(digest({ a: ['1', 1] }));
  expect(digest({ a: false })).not.toBe(digest({}));
  expect(digest(0)).not.toBe(digest(-0));
  expect(digest({ integerValue: '1' })).not.toBe(digest({ doubleValue: 1 }));
  expect(digest(Buffer.from('a'))).not.toBe(digest('a'));
  expect(() => digest({ missing: undefined })).toThrow('restore_unsupported_value');
});
