import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST;
(enabled ? describe : describe.skip)('verifiable daily-record authority base', () => {
  const date = '2026-05-13';
  const stamp = '2026-05-13T12:00:00.000Z';
  const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
  let app: App;
  let db: Firestore;
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
      throw new Error('Local emulator required');
    app = initializeApp({ projectId: 'demo-hhr-verifiable-write-base' }, 'verifiable-write-base');
    db = getFirestore(app);
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => 'admin',
    });
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  beforeEach(async () => {
    await db.recursiveDelete(db.doc('hospitals/hanga_roa'));
    await db.doc(dayPath).set({
      ...makeRecord(),
      lastUpdated: Timestamp.fromDate(new Date(stamp)),
      meta: { revision: 2, lastMutationId: 'synthetic-prior' },
    });
  });
  const invoke = (operation: 'save' | 'patch', extra: Record<string, unknown> = {}) => {
    const change =
      operation === 'save'
        ? {
            record: {
              ...makeRecord(),
              beds: { R1: { ...makeRecord().beds.R1, pathology: 'CAMBIO SINTETICO' } },
            },
          }
        : { patch: { 'beds.R1.pathology': 'CAMBIO SINTETICO' } };
    return api[`${operation}DailyRecordWithClinicalAuthority`].run(
      { date, mode: 'enforced', ...change, ...extra },
      makeContext()
    );
  };
  describe.each(['save', 'patch'] as const)(
    '%s authority base in a real transaction',
    operation => {
      it.each([
        ['absent', {}, 'failed-precondition'],
        ['future', { expectedLastUpdated: '2026-05-13T13:00:00.000Z' }, 'aborted'],
      ] as const)(
        'refuses an %s base without changing the day or history',
        async (_label, extra, code) => {
          const before = await db.doc(dayPath).get();
          await expect(invoke(operation, extra)).rejects.toMatchObject({ code });
          const after = await db.doc(dayPath).get();
          expect(after.data()).toEqual(before.data());
          expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
          expect((await db.doc(dayPath).collection('history').get()).empty).toBe(true);
        }
      );
      it('accepts the exact stored Timestamp through its ISO representation', async () => {
        await expect(invoke(operation, { expectedLastUpdated: stamp })).resolves.toMatchObject({
          success: true,
          revision: 3,
        });
        const saved = (await db.doc(dayPath).get()).data()!;
        expect(saved.beds.R1.pathology).toBe('CAMBIO SINTETICO');
      });
      it('acknowledges the known mutation without reapplying it when the original base is missing', async () => {
        const syncContract = {
          mutationId: `synthetic-${operation}-ack`,
          baseRevision: 2,
          changedPaths: ['beds.R1.pathology'],
        };
        await invoke(operation, { syncContract });
        const before = await db.doc(dayPath).get();
        await expect(
          invoke(operation, { syncContract: { mutationId: syncContract.mutationId } })
        ).resolves.toMatchObject({ success: true, authorityStatus: 'idempotent', revision: 3 });
        const after = await db.doc(dayPath).get();
        expect(after.data()).toEqual(before.data());
        expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
      });
    }
  );
  it('allows creation without pretending that an existing base was read', async () => {
    await db.doc(dayPath).delete();
    await expect(invoke('save')).resolves.toMatchObject({ success: true, revision: 1 });
    expect((await db.doc(dayPath).get()).data()?.beds.R1.pathology).toBe('CAMBIO SINTETICO');
  });
  it('only accepts one of two concurrent writers of the same base', async () => {
    const results = await Promise.allSettled([
      invoke('save', { expectedLastUpdated: stamp }),
      invoke('patch', { expectedLastUpdated: stamp }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.doc(dayPath).get()).data()?.meta.revision).toBe(3);
  });
});
