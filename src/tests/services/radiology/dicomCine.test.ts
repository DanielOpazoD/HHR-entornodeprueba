import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortableDicomTask,
  playDicomCine,
  validateCineOptions,
} from '@/services/radiology/dicomCine';

afterEach(() => vi.useRealTimers());
describe('verified slice cine', () => {
  it.each([
    { start: -1, end: 4, fps: 10 },
    { start: 4, end: 3, fps: 10 },
    { start: 0, end: 10, fps: 10 },
    { start: 0.5, end: 3, fps: 10 },
    { start: 0, end: 3, fps: 0 },
    { start: 0, end: 3, fps: NaN },
  ])('rejects invalid ranges %j', options => {
    expect(() => validateCineOptions(options, 10)).toThrow();
  });
  it('waits for each requested cut, preserves order and plays the inclusive last cut', async () => {
    vi.useFakeTimers();
    let release!: (value: HTMLCanvasElement) => void;
    const canvas = document.createElement('canvas');
    const frame = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue(canvas);
    const progress = vi.fn();
    const job = playDicomCine(
      { frame, close: vi.fn() },
      { start: 2, end: 4, fps: 10 },
      10,
      new AbortController().signal,
      progress
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(frame.mock.calls.map(call => call[0])).toEqual([2]);
    release(canvas);
    await vi.advanceTimersByTimeAsync(300);
    await job;
    expect(frame.mock.calls.map(call => call[0])).toEqual([2, 3, 4]);
    expect(progress).toHaveBeenLastCalledWith({ completed: 3, total: 3, stage: 'Reproduciendo' });
  });
  it('cancels pending waits and handles late producer failures', async () => {
    const controller = new AbortController();
    let reject!: (error: Error) => void;
    const job = abortableDicomTask(
      new Promise((_, no) => {
        reject = no;
      }),
      controller.signal
    );
    controller.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    reject(new Error('late'));
    await Promise.resolve();
  });
  it('handles producer rejection when cancellation already happened', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      abortableDicomTask(Promise.reject(new Error('producer failure')), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('stops playback during its delay without requesting another cut', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const frame = vi.fn().mockResolvedValue(document.createElement('canvas'));
    const job = playDicomCine(
      { frame, close: vi.fn() },
      { start: 0, end: 9, fps: 5 },
      10,
      controller.signal,
      vi.fn()
    );
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(frame).toHaveBeenCalledTimes(1);
  });
});
