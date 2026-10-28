import { describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
const stamp = '2026-05-13T12:00:00.000Z';
const stored = () => ({
  ...makeRecord(),
  lastUpdated: stamp,
  meta: { revision: 2, lastMutationId: 'synthetic-prior' },
});
const setup = (remoteData: Record<string, unknown> | undefined) => {
  const mock = createAdminMock({ remoteData });
  const api = createDailyRecordWriteAuthorityFunctions({
    firestore: mock.admin.firestore(),
    Timestamp: mock.admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  });
  return {
    ...mock,
    save: (extra: Record<string, unknown> = {}) =>
      api.saveDailyRecordWithClinicalAuthority.run(
        { date: '2026-05-13', record: makeRecord(), mode: 'enforced', ...extra },
        makeContext()
      ),
  };
};
describe('existing-record full-save base used by outbox replay', () => {
  describe.each([
    { label: 'omitted paths', paths: {} },
    { label: 'empty paths', paths: { changedPaths: [] } },
    { label: 'whole-record paths', paths: { changedPaths: ['*'] } },
    { label: 'mixed opaque paths', paths: { changedPaths: ['beds.R1.pathology', '*'] } },
  ])('$label', ({ paths }) => {
    it.each([0, 2])(
      'rejects a later expected timestamp with matching revision %i',
      async revision => {
        const { save, set, update, historySet } = setup({
          ...stored(),
          meta: { revision },
        });
        await expect(
          save({
            expectedLastUpdated: '2026-05-13T12:00:00.001Z',
            syncContract: { ...paths, baseRevision: revision },
          })
        ).rejects.toMatchObject({
          code: 'aborted',
          message: expect.stringContaining('version_mismatch'),
        });
        expect(set).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(historySet).not.toHaveBeenCalled();
      }
    );

    it.each(['invalid-timestamp', '', ' ', null, 10, false, {}])(
      'rejects supplied invalid expected timestamp %j despite a matching revision',
      async expectedLastUpdated => {
        const { save, set, update, historySet } = setup(stored());
        await expect(
          save({ expectedLastUpdated, syncContract: { ...paths, baseRevision: 2 } })
        ).rejects.toMatchObject({
          code: 'failed-precondition',
          message: expect.stringContaining('base_required'),
        });
        expect(set).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(historySet).not.toHaveBeenCalled();
      }
    );

    it.each([
      { label: 'exact timestamp and revision', input: { expectedLastUpdated: stamp } },
      {
        label: 'equivalent normalized timestamp and revision',
        input: { expectedLastUpdated: '2026-05-13T06:00:00-06:00' },
      },
      { label: 'revision without timestamp', input: {} },
    ])('accepts $label', async ({ input }) => {
      const { save, set, update, historySet, docRef } = setup(stored());
      await expect(
        save({ ...input, syncContract: { ...paths, baseRevision: 2 } })
      ).resolves.toMatchObject({ success: true, revision: 3 });
      expect(set).toHaveBeenCalledExactlyOnceWith(
        docRef,
        expect.objectContaining({
          beds: makeRecord().beds,
          meta: expect.objectContaining({ revision: 3 }),
        })
      );
      expect(update).not.toHaveBeenCalled();
      expect(historySet).toHaveBeenCalledOnce();
    });
  });

  it.each([
    { label: 'explicit zero', remoteMeta: { revision: 0 }, baseRevision: 0 },
    { label: 'string zero', remoteMeta: { revision: 0 }, baseRevision: '0' },
    { label: 'legacy zero', remoteMeta: undefined, baseRevision: 0 },
  ])('preserves $label without an expected timestamp', async ({ remoteMeta, baseRevision }) => {
    const { save, set } = setup({ ...stored(), lastUpdated: undefined, meta: remoteMeta });
    await expect(
      save({ syncContract: { baseRevision, changedPaths: ['*'] } })
    ).resolves.toMatchObject({
      success: true,
      revision: 1,
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'invalid-remote-timestamp'])(
    'requires a valid remote timestamp %j when an expected timestamp was supplied',
    async lastUpdated => {
      const { save, set, update, historySet } = setup({ ...stored(), lastUpdated });
      await expect(
        save({ expectedLastUpdated: stamp, syncContract: { baseRevision: 2, changedPaths: ['*'] } })
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(historySet).not.toHaveBeenCalled();
    }
  );

  it('does not accept a client flag that attempts to disable the exact check', async () => {
    const { save, set } = setup(stored());
    await expect(
      save({
        expectedLastUpdated: '2026-05-13T12:00:00.001Z',
        requireExactExpectedVersion: false,
        syncContract: { baseRevision: 2, changedPaths: ['*'], requireExactExpectedVersion: false },
      })
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(set).not.toHaveBeenCalled();
  });

  it.each(['2026-05-13T11:59:59.999Z', '2026-05-13T12:00:00.001Z'])(
    'rejects changed timestamp %s on a retried callback with the same revision',
    async lastUpdated => {
      const remote = stored();
      const { admin, transaction, set, update, historySet } = createAdminMock({
        remoteData: remote,
      });
      const firstAttempt = { ...transaction, set: vi.fn(), update: vi.fn() };
      const firestore = {
        ...admin.firestore(),
        runTransaction: async (callback: (tx: typeof transaction) => unknown) => {
          await callback(firstAttempt);
          remote.lastUpdated = lastUpdated;
          return callback(transaction);
        },
      };
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore,
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });

      await expect(
        api.saveDailyRecordWithClinicalAuthority.run(
          {
            date: remote.date,
            record: makeRecord(),
            expectedLastUpdated: stamp,
            syncContract: { baseRevision: 2, changedPaths: ['*'] },
          },
          makeContext()
        )
      ).rejects.toMatchObject({
        code: 'aborted',
        message: expect.stringContaining('version_mismatch'),
      });
      expect(firstAttempt.set).toHaveBeenCalledOnce();
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(historySet).not.toHaveBeenCalled();
      expect(remote).toEqual({ ...stored(), lastUpdated });
    }
  );

  it.each([
    { label: 'later timestamp', input: { expectedLastUpdated: '2026-05-13T12:00:00.001Z' } },
    { label: 'empty timestamp', input: { expectedLastUpdated: '' } },
    { label: 'no timestamp', input: {} },
  ])('preserves granular full-save behavior with $label', async ({ input }) => {
    const { save, set } = setup(stored());
    await expect(
      save({ ...input, syncContract: { baseRevision: 2, changedPaths: ['beds.R1.pathology'] } })
    ).resolves.toMatchObject({ success: true, revision: 3 });
    expect(set).toHaveBeenCalledOnce();
  });

  it('preserves the patch route with a later timestamp and matching revision', async () => {
    const { admin, set, update } = createAdminMock({ remoteData: stored() });
    const api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    await expect(
      api.patchDailyRecordWithClinicalAuthority.run(
        {
          date: '2026-05-13',
          expectedLastUpdated: '2026-05-13T12:00:00.001Z',
          syncContract: { baseRevision: 2, changedPaths: ['*'] },
          patch: { 'beds.R1.pathology': 'Cambio sintético' },
        },
        makeContext()
      )
    ).resolves.toMatchObject({ success: true, revision: 3 });
    expect(set).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it('preserves dry-run with a later timestamp and matching revision', async () => {
    const { save, set, update, historySet } = setup(stored());
    await expect(
      save({
        dryRun: true,
        expectedLastUpdated: '2026-05-13T12:00:00.001Z',
        syncContract: { baseRevision: 2, changedPaths: ['*'] },
      })
    ).resolves.toMatchObject({ success: true });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });

  it.each([
    ['omitted', {}],
    ['future', { expectedLastUpdated: '2026-05-13T13:00:00.000Z' }],
  ])('refuses an %s base without a write', async (_label, extra) => {
    const { save, set, update, historySet } = setup(stored());
    await expect(save(extra)).rejects.toBeDefined();
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });
  it('accepts a matching legacy timestamp', async () => {
    const { save } = setup(stored());
    await expect(save({ expectedLastUpdated: stamp })).resolves.toMatchObject({ success: true });
  });
  it('allows creating an absent day without an existing base', async () => {
    const { save, set, historySet } = setup(undefined);
    await expect(save()).resolves.toMatchObject({ success: true });
    expect(set).toHaveBeenCalledOnce();
    expect(historySet).not.toHaveBeenCalled();
  });
  it.each(['invalid-timestamp', '2026-05-13T12:00:00.001Z'])(
    'preserves absent-day creation with a supplied timestamp %s',
    async expectedLastUpdated => {
      const { save, set, historySet } = setup(undefined);
      await expect(
        save({ expectedLastUpdated, syncContract: { baseRevision: 2, changedPaths: ['*'] } })
      ).resolves.toMatchObject({ success: true, revision: 1 });
      expect(set).toHaveBeenCalledOnce();
      expect(historySet).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, 'invalid-timestamp', '2026-05-13T12:00:00.001Z'])(
    'recognizes a committed full-save replay before validating timestamp %s',
    async expectedLastUpdated => {
      const { save, set, update, historySet } = setup(stored());
      await expect(
        save({
          expectedLastUpdated,
          syncContract: { mutationId: 'synthetic-prior', baseRevision: 0, changedPaths: ['*'] },
        })
      ).resolves.toMatchObject({ success: true, authorityStatus: 'idempotent', revision: 2 });
      expect(set).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(historySet).not.toHaveBeenCalled();
    }
  );
});
