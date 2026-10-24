import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  storage,
  makeBase,
  makeIntent,
  commit,
  receipt,
  save,
  resetSpecialtyStorage,
} from './dailyRecordSpecialtyRecoverySupport';

beforeEach(resetSpecialtyStorage);

describe('manual specialty save reads', () => {
  it.each([undefined, 'invalid', -1])(
    'retains the fresh read for legacy revision %s',
    async revision => {
      const base = { ...makeBase(), meta: revision === undefined ? undefined : { revision } };
      const remote = makeBase();
      const committed = commit(remote, makeIntent(), 'confirmed');
      storage.read.mockResolvedValue(remote);
      storage.write.mockResolvedValue(receipt(committed));
      expect((await save(base)).confirmedRecord).toEqual(committed);
      expect(storage.read).toHaveBeenCalledTimes(1);
      expect(storage.read.mock.invocationCallOrder[0]).toBeLessThan(
        storage.write.mock.invocationCallOrder[0]
      );
    }
  );

  it('rejects a changed episode before sending an unversioned legacy decision', async () => {
    const base = { ...makeBase(), meta: undefined };
    const remote = makeBase();
    remote.beds.R1.clinicalEpisodeId = 'replacement';
    storage.read.mockResolvedValue(remote);
    await expect(save(base)).rejects.toThrow();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.adopt).not.toHaveBeenCalled();
  });

  it('uses the higher locally adopted revision even when its timestamp is earlier', async () => {
    const base = makeBase();
    const local = { ...makeBase(), meta: { revision: 3 }, lastUpdated: '2026-02-18T08:00:00.000Z' };
    storage.localRead.mockResolvedValue(local);
    storage.write.mockResolvedValue(receipt(commit(local, makeIntent(), 'confirmed')));
    expect((await save(base)).updatedRemotely).toBe(true);
    expect(storage.write.mock.calls[0][2]).toBe(local.lastUpdated);
    expect(storage.write.mock.calls[0][3].syncContract.baseRevision).toBe(3);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 1])(
    'ignores local revision %s with a future client timestamp',
    async revision => {
      const base = makeBase();
      storage.localRead.mockResolvedValue({
        ...base,
        meta: { revision },
        lastUpdated: '2099-01-01T00:00:00.000Z',
      });
      storage.write.mockResolvedValue(receipt(commit(base, makeIntent(), 'confirmed')));
      expect((await save(base)).updatedRemotely).toBe(true);
      expect(storage.write.mock.calls[0][2]).toBe(base.lastUpdated);
      expect(storage.write.mock.calls[0][3].syncContract.baseRevision).toBe(1);
      expect(storage.read).not.toHaveBeenCalled();
    }
  );

  it.each(
    (['bed', 'clinicalCrib'] as const).flatMap(target =>
      ['legacy', 'split', 'local_unavailable'].map(mode => ({ target, mode }))
    )
  )(
    'confirms $target ($mode) from the observed version without a redundant server read',
    async ({ target, mode }) => {
      const base = makeBase(target);
      if (mode === 'split') base.clinicalDerivedLayout = { version: 1, generation: 'synthetic' };
      if (mode === 'local_unavailable')
        storage.localRead.mockRejectedValue(new Error('local unavailable'));
      const intent = makeIntent(target);
      const committed = commit(base, intent, 'synthetic-confirmed-decision');
      let confirm!: () => void;
      storage.read.mockResolvedValue(base);
      storage.write.mockImplementation(
        () =>
          new Promise(resolve => {
            confirm = () => resolve(receipt(committed));
          })
      );
      const pending = save(base, intent);
      await vi.waitFor(() => expect(storage.write).toHaveBeenCalledTimes(1));
      const readsBeforeConfirmation = storage.read.mock.calls.length;
      expect(storage.adopt).not.toHaveBeenCalled();
      expect(storage.queue).not.toHaveBeenCalled();
      confirm();
      expect((await pending).confirmedRecord).toEqual(committed);
      expect(committed.clinicalDerivedLayout).toEqual(base.clinicalDerivedLayout);
      expect(readsBeforeConfirmation).toBe(0);
      expect(storage.read).not.toHaveBeenCalled();
    }
  );
});
