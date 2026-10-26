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
    const { save } = setup(undefined);
    await expect(save()).resolves.toMatchObject({ success: true });
  });
  it('recognizes a committed full-save replay before requiring a base', async () => {
    const { save, set, update } = setup(stored());
    await expect(save({ syncContract: { mutationId: 'synthetic-prior' } })).resolves.toMatchObject({
      success: true,
      authorityStatus: 'idempotent',
    });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
