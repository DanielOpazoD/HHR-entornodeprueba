// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  parsePruneHistoryArgs,
  runPruneHistoryCli,
} from '../../../scripts/prune-daily-record-history.mjs';
import { store, copies } from './dailyRecordHistoryPrune.test-support';

// Old synthetic dates make CLI execution independent of the date of the test run.
const openSyntheticStore = () => {
  const days = new Map([['2000-01-01', copies(3)]]);
  const db = store(days);
  const close = vi.fn().mockResolvedValue(undefined);
  const openFirestore = vi.fn().mockResolvedValue({ firestore: db.firestore, close });
  return { days, db, close, openFirestore };
};

describe('manual history prune CLI', () => {
  it.each(
    [
      [],
      ['--apply'],
      ['--project'],
      ['--project', 'other-project'],
      ['--project', 'hhr-pruebas', '--unknown'],
      ['--project', 'hhr-pruebas', '--project', 'other-project'],
    ].map(args => ({ args }))
  )('rejects unsafe or ambiguous arguments before opening Firestore: %j', async ({ args }) => {
    const { openFirestore } = openSyntheticStore();
    await expect(runPruneHistoryCli({ args, env: {}, openFirestore })).rejects.toThrow();
    expect(openFirestore).not.toHaveBeenCalled();
  });

  it('defaults to dry-run, logs only counts, and closes the SDK', async () => {
    const { days, db, close, openFirestore } = openSyntheticStore();
    const log = vi.fn();
    await runPruneHistoryCli({ args: ['--project', 'hhr-pruebas'], env: {}, openFirestore, log });
    expect(days.get('2000-01-01')?.size).toBe(3);
    expect(db.batches).toEqual([]);
    expect(openFirestore).toHaveBeenCalledWith('hhr-pruebas');
    expect(log).toHaveBeenCalledWith({
      dryRun: true,
      daysReviewed: 1,
      snapshotsDeleted: 0,
      snapshotsKept: 3,
      snapshotsToDelete: 1,
      stoppedForTime: false,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('deletes only with --apply', async () => {
    const { days, close, openFirestore } = openSyntheticStore();
    const result = await runPruneHistoryCli({
      args: ['--apply', '--project', 'hhr-pruebas'],
      env: {},
      openFirestore,
      log: vi.fn(),
    });
    expect(result.snapshotsDeleted).toBe(1);
    expect(days.get('2000-01-01')?.size).toBe(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it('permits another explicit project only with an emulator', () => {
    expect(
      parsePruneHistoryArgs(['--project', 'demo-history'], {
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      })
    ).toEqual({ project: 'demo-history', apply: false });
    expect(() =>
      parsePruneHistoryArgs([], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })
    ).toThrow();
  });
});
