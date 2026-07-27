import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueLatestRayenClinicalFill,
  resetRayenClinicalFillQueueForTests,
} from '@/features/rayen-import/domain/rayenClinicalFillQueue';

afterEach(() => resetRayenClinicalFillQueueForTests());

describe('rayen clinical fill queue', () => {
  it('coalesces duplicate requests for the same applied run', async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>(resolve => (release = resolve)));

    const first = enqueueLatestRayenClinicalFill('2026-07-27|run-1', task);
    const duplicate = enqueueLatestRayenClinicalFill('2026-07-27|run-1', task);
    expect(task).toHaveBeenCalledTimes(1);
    release();

    await expect(Promise.all([first, duplicate])).resolves.toEqual(['drained', 'drained']);
  });

  it('keeps only the latest pending run while the active run finishes', async () => {
    let release!: () => void;
    const order: string[] = [];
    const active = enqueueLatestRayenClinicalFill('run-1', async () => {
      order.push('run-1');
      await new Promise<void>(resolve => (release = resolve));
    });
    const superseded = enqueueLatestRayenClinicalFill('run-2', async () => {
      order.push('run-2');
    });
    const latest = enqueueLatestRayenClinicalFill('run-3', async () => {
      order.push('run-3');
    });

    await expect(superseded).resolves.toBe('superseded');
    release();
    await expect(Promise.all([active, latest])).resolves.toEqual(['completed', 'drained']);
    expect(order).toEqual(['run-1', 'run-3']);
  });
});
