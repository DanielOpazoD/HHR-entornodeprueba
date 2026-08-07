import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueLatestRayenClinicalFill,
  resetRayenClinicalFillQueueForTests,
} from '@/features/rayen-import/domain/rayenClinicalFillQueue';
import { logger } from '@/services/utils/loggerService';

afterEach(() => {
  resetRayenClinicalFillQueueForTests();
  vi.restoreAllMocks();
  logger.clearEntries();
});

describe('rayen clinical fill queue', () => {
  it('coalesces duplicate requests for the same applied run', async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>(resolve => (release = resolve)));

    const first = enqueueLatestRayenClinicalFill(
      '2026-07-27',
      '2026-07-27|run-1',
      task
    );
    const duplicate = enqueueLatestRayenClinicalFill(
      '2026-07-27',
      '2026-07-27|run-1',
      task
    );
    expect(task).toHaveBeenCalledTimes(1);
    release();

    await expect(Promise.all([first, duplicate])).resolves.toEqual(['drained', 'drained']);
  });

  it('keeps only the latest pending run while the active run finishes', async () => {
    let release!: () => void;
    const order: string[] = [];
    const active = enqueueLatestRayenClinicalFill('2026-07-27', 'run-1', async () => {
      order.push('run-1');
      await new Promise<void>(resolve => (release = resolve));
    });
    const superseded = enqueueLatestRayenClinicalFill('2026-07-27', 'run-2', async () => {
      order.push('run-2');
    });
    const latest = enqueueLatestRayenClinicalFill('2026-07-27', 'run-3', async () => {
      order.push('run-3');
    });

    await expect(superseded).resolves.toBe('superseded');
    release();
    await expect(Promise.all([active, latest])).resolves.toEqual(['completed', 'drained']);
    expect(order).toEqual(['run-1', 'run-3']);
  });

  it('tells a task whether it started immediately or after waiting in the queue', async () => {
    let release!: () => void;
    const immediateTask = vi.fn(() => new Promise<void>(resolve => (release = resolve)));
    const queuedTask = vi.fn().mockResolvedValue(undefined);

    const immediate = enqueueLatestRayenClinicalFill('2026-07-27', 'run-1', immediateTask);
    const queued = enqueueLatestRayenClinicalFill('2026-07-27', 'run-2', queuedTask);

    expect(immediateTask).toHaveBeenCalledWith({ startedAfterQueue: false });
    expect(queuedTask).not.toHaveBeenCalled();

    release();
    await expect(Promise.all([immediate, queued])).resolves.toEqual(['completed', 'drained']);
    expect(queuedTask).toHaveBeenCalledWith({ startedAfterQueue: true });
  });

  it('records synchronous task failures without leaking details or blocking the pending run', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const failed = enqueueLatestRayenClinicalFill('2026-07-27', 'run-1', () => {
      throw new Error('sensitive provider detail');
    });
    const nextTask = vi.fn().mockResolvedValue(undefined);
    const next = enqueueLatestRayenClinicalFill('2026-07-27', 'run-2', nextTask);

    await expect(Promise.all([failed, next])).resolves.toEqual(['completed', 'drained']);

    expect(nextTask).toHaveBeenCalledTimes(1);
    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'clinical_fill_queue_task_failed',
        context: 'RayenSync',
        data: { date: '2026-07-27', errorKind: 'unexpected' },
      })
    );
    expect(JSON.stringify(logger.getEntries())).not.toContain('sensitive provider detail');
  });

  it('starts the pending run after the active asynchronous task rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let rejectActive!: (error: Error) => void;
    const failed = enqueueLatestRayenClinicalFill(
      '2026-07-27',
      'run-1',
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectActive = reject;
        })
    );
    const nextTask = vi.fn().mockResolvedValue(undefined);
    const next = enqueueLatestRayenClinicalFill('2026-07-27', 'run-2', nextTask);

    expect(nextTask).not.toHaveBeenCalled();
    rejectActive(new Error('another sensitive provider detail'));

    await expect(Promise.all([failed, next])).resolves.toEqual(['completed', 'drained']);
    expect(nextTask).toHaveBeenCalledTimes(1);
    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'clinical_fill_queue_task_failed',
        context: 'RayenSync',
        data: { date: '2026-07-27', errorKind: 'unexpected' },
      })
    );
    expect(JSON.stringify(logger.getEntries())).not.toContain('another sensitive provider detail');
  });

  it('preserves pending fills for different census dates', async () => {
    let release!: () => void;
    const order: string[] = [];
    const active = enqueueLatestRayenClinicalFill('2026-07-27', 'run-active', async () => {
      order.push('2026-07-27');
      await new Promise<void>(resolve => (release = resolve));
    });
    const nextDate = enqueueLatestRayenClinicalFill('2026-07-28', 'run-next', async () => {
      order.push('2026-07-28');
    });
    const laterDate = enqueueLatestRayenClinicalFill('2026-07-29', 'run-later', async () => {
      order.push('2026-07-29');
    });

    release();

    await expect(Promise.all([active, nextDate, laterDate])).resolves.toEqual([
      'completed',
      'completed',
      'drained',
    ]);
    expect(order).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });

  it('does not coalesce an active key reused by a different census date', async () => {
    let release!: () => void;
    const order: string[] = [];
    const active = enqueueLatestRayenClinicalFill('2026-07-27', 'shared-key', async () => {
      order.push('2026-07-27');
      await new Promise<void>(resolve => (release = resolve));
    });
    const nextDate = enqueueLatestRayenClinicalFill('2026-07-28', 'shared-key', async () => {
      order.push('2026-07-28');
    });

    release();

    await expect(Promise.all([active, nextDate])).resolves.toEqual(['completed', 'drained']);
    expect(order).toEqual(['2026-07-27', '2026-07-28']);
  });
});
