import { describe, expect, it, vi } from 'vitest';
import type { StackViewport } from '@cornerstonejs/core';
import { createProgressiveStack } from '@/features/radiology/services/dicomProgressiveStack';
import type {
  LoadedDicomSeries,
  ProgressiveDicomSeries,
} from '@/features/radiology/services/dicomSeriesLoader';

const createMockSeries = (
  request: (index: number) => Promise<string>,
  initialIndex = 0
): ProgressiveDicomSeries => ({
  initialIndex,
  request,
  hasOrientation: () => false,
  completion: new Promise<LoadedDicomSeries>(() => undefined),
  settled: Promise.resolve(),
  cancel: vi.fn(),
  loading: {
    request,
    prefetch: vi.fn(),
    focus: vi.fn(),
    timing: vi.fn(),
    transferred: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    snapshot: vi.fn(),
    settled: Promise.resolve(),
  } as unknown as ProgressiveDicomSeries['loading'],
});

const createMockViewport = (overrides: Record<string, unknown> = {}): StackViewport =>
  ({
    element: document.createElement('div'),
    setStack: vi.fn().mockResolvedValue(undefined),
    getProperties: () => ({}),
    setProperties: vi.fn(),
    getPan: () => [0, 0],
    getZoom: () => 1,
    setPan: vi.fn(),
    setZoom: vi.fn(),
    render: vi.fn(),
    ...overrides,
  }) as unknown as StackViewport;

it('keeps the latest requested cut when downloads arrive out of order and cancels detached views', async () => {
  const waiting = new Map<number, (id: string) => void>();
  const source = createMockSeries(
    vi.fn((index: number) =>
      index === 0
        ? Promise.resolve('first')
        : new Promise<string>(resolve => waiting.set(index, resolve))
    )
  );
  const target = createMockViewport({
    getProperties: () => ({ invert: true }),
    getPan: () => [2, 3],
    getZoom: () => 2,
  });
  const stack = createProgressiveStack(source, 10);
  await stack.show(target);
  stack.select(1);
  stack.select(2);
  expect(stack.state()).toMatchObject({ requested: 2, current: 0, pending: true });
  waiting.get(2)!('second');
  await vi.waitFor(() => expect(stack.state()).toMatchObject({ current: 2, pending: false }));
  waiting.get(1)!('stale');
  await Promise.resolve();
  expect(target.setStack).toHaveBeenCalledTimes(2);
  expect(target.setStack).toHaveBeenLastCalledWith(['second']);
  expect(target.setProperties).toHaveBeenLastCalledWith({ invert: true });
  stack.select(3);
  stack.detach();
  waiting.get(3)!('closed');
  await Promise.resolve();
  expect(target.setStack).toHaveBeenCalledTimes(2);
});

describe('pending cut boundaries', () => {
  it('bounds wheel requests at the actual series positions', async () => {
    const source = createMockSeries(vi.fn().mockResolvedValue('image'));
    const stack = createProgressiveStack(source, 3);
    stack.step(-1);
    expect(source.request).toHaveBeenLastCalledWith(0);
    stack.select(999);
    expect(source.request).toHaveBeenLastCalledWith(2);
    stack.select(Number.NaN);
    expect(source.request).toHaveBeenCalledTimes(2);
  });
});

it('drains an in-flight presentation before allowing viewport teardown', async () => {
  let finish!: () => void;
  const source = createMockSeries(vi.fn().mockResolvedValue('image'));
  const target = createMockViewport({
    setStack: vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    ),
  });
  const stack = createProgressiveStack(source, 3);
  const showing = stack.show(target);
  await vi.waitFor(() => expect(target.setStack).toHaveBeenCalledTimes(1));
  let drained = false;
  const draining = stack.detach().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  finish();
  await Promise.all([showing, draining]);
  expect(drained).toBe(true);
  expect(target.render).not.toHaveBeenCalled();
  expect(stack.state().current).toBeNull();
});

it('restores presentation before a newer cut snapshots an interrupted render', async () => {
  let zoom = 3;
  let finish!: () => void;
  const source = createMockSeries(vi.fn().mockResolvedValue('image'));
  const setStack = vi.fn().mockResolvedValue(undefined);
  const target = createMockViewport({
    setStack,
    getProperties: () => ({ invert: true }),
    getPan: () => [2, 3],
    getZoom: () => zoom,
    setZoom: (value: number) => {
      zoom = value;
    },
  });
  const stack = createProgressiveStack(source, 3);
  await stack.show(target);
  setStack.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        zoom = 1;
        finish = resolve;
      })
  );
  stack.select(1);
  await vi.waitFor(() => expect(setStack).toHaveBeenCalledTimes(2));
  stack.select(2);
  finish();
  await vi.waitFor(() => expect(stack.state()).toMatchObject({ current: 2, pending: false }));
  expect(zoom).toBe(3);
});

it('locks interactive requests during cine and aborts a missing cut before it can replace the current cut', async () => {
  let release!: (id: string) => void;
  const source = createMockSeries(
    vi.fn((index: number) =>
      index === 0
        ? Promise.resolve('first')
        : new Promise<string>(resolve => {
            release = resolve;
          })
    )
  );
  const target = createMockViewport();
  const stack = createProgressiveStack(source, 3);
  await stack.show(target);
  stack.lock(true);
  stack.step(1);
  stack.select(2);
  expect(source.request).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  const pending = stack.selectAndWait(1, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  stack.lock(false);
  stack.select(0);
  release('late');
  await vi.waitFor(() => expect(stack.state()).toMatchObject({ current: 0, pending: false }));
  expect(target.setStack).not.toHaveBeenCalledWith(['late']);
});
