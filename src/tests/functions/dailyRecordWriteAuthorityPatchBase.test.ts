import { describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const date = '2026-05-13';
const currentVersion = '2026-05-13T12:00:00.000Z';
const patch = { 'beds.R1.pathology': 'CAMBIO SINTETICO' };
const setup = (remoteChanges: Record<string, unknown> = {}) => {
  const mock = createAdminMock({
    remoteData: {
      ...makeRecord(),
      lastUpdated: currentVersion,
      meta: { revision: 2, lastMutationId: 'synthetic-other' },
      ...remoteChanges,
    },
  });
  const api = createDailyRecordWriteAuthorityFunctions({
    firestore: mock.admin.firestore(),
    Timestamp: mock.admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  });
  return {
    ...mock,
    write: (input: Record<string, unknown>) =>
      api.patchDailyRecordWithClinicalAuthority.run({ date, patch, ...input }, makeContext()),
  };
};

describe('ordinary authority patch requires a verifiable base', () => {
  it.each([
    ['omitted base', {}],
    ['empty base', { expectedLastUpdated: '', syncContract: { baseRevision: '' } }],
    ['invalid revision without timestamp', { syncContract: { baseRevision: 'invalid' } }],
    ['future timestamp without a revision', { expectedLastUpdated: '2026-05-13T13:00:00.000Z' }],
  ])('refuses %s without changing remote data', async (_label, input) => {
    const { write, update, set, historySet } = setup();
    await expect(write(input)).rejects.toBeDefined();
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(historySet).not.toHaveBeenCalled();
  });

  it('refuses a timestamp-only write when the stored day has no timestamp', async () => {
    const { write, update, set } = setup({ lastUpdated: undefined, meta: undefined });
    await expect(write({ expectedLastUpdated: currentVersion })).rejects.toBeDefined();
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ['matching timestamp for an existing client', { expectedLastUpdated: currentVersion }],
    ['matching revision', { syncContract: { baseRevision: 2, mutationId: 'synthetic-next' } }],
    ['numeric legacy revision', { syncContract: { baseRevision: '2' } }],
  ])('accepts %s once', async (_label, input) => {
    const { write, update } = setup();
    await expect(write(input)).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalledOnce();
  });

  it.each(
    [false, true, [], [0], {}, ' ', '0x0', -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(value => [
      value,
    ])
  )('does not infer a legacy revision from %p', async baseRevision => {
    const { write, update, set } = setup({ meta: undefined });
    await expect(write({ syncContract: { baseRevision } })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('base_required'),
    });
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('supports a legacy stored day through an explicit initial revision', async () => {
    const { write, update } = setup({ lastUpdated: undefined, meta: undefined });
    await expect(write({ syncContract: { baseRevision: 0 } })).resolves.toMatchObject({
      success: true,
      revision: 1,
    });
    expect(update).toHaveBeenCalledOnce();
  });

  it('recognizes a confirmed replay without writing even if its original base is absent', async () => {
    const { write, update, set } = setup();
    await expect(write({ syncContract: { mutationId: 'synthetic-other' } })).resolves.toMatchObject(
      { success: true, authorityStatus: 'idempotent', revision: 2 }
    );
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
