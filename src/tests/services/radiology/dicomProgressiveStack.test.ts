import { describe, expect, it, vi } from 'vitest';
import type { StackViewport } from '@cornerstonejs/core';
import { createProgressiveStack } from '@/services/radiology/dicomProgressiveStack';
import type { ProgressiveDicomSeries } from '@/services/radiology/dicomSeriesLoader';

it('keeps the latest requested cut when downloads arrive out of order and cancels detached views', async () => {
  const waiting = new Map<number, (id: string) => void>();
  const source = {
    initialIndex: 0,
    request: vi.fn((index: number) =>
      index === 0
        ? Promise.resolve('first')
        : new Promise<string>(resolve => waiting.set(index, resolve))
    ),
  } as unknown as ProgressiveDicomSeries;
  const target = {
    element: document.createElement('div'),
    setStack: vi.fn().mockResolvedValue(undefined),
    getProperties: () => ({ invert: true }),
    setProperties: vi.fn(),
    getPan: () => [2, 3],
    getZoom: () => 2,
    setPan: vi.fn(),
    setZoom: vi.fn(),
    render: vi.fn(),
  } as unknown as StackViewport;
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
    const source = {
      initialIndex: 0,
      request: vi.fn().mockResolvedValue('image'),
    } as unknown as ProgressiveDicomSeries;
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
  const source = {
    initialIndex: 0,
    request: vi.fn().mockResolvedValue('image'),
  } as unknown as ProgressiveDicomSeries;
  const target = {
    element: document.createElement('div'),
    setStack: vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    ),
    render: vi.fn(),
  } as unknown as StackViewport;
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
  const source = {
    initialIndex: 0,
    request: vi.fn().mockResolvedValue('image'),
  } as unknown as ProgressiveDicomSeries;
  const setStack = vi.fn().mockResolvedValue(undefined);
  const target = {
    element: document.createElement('div'),
    setStack,
    getProperties: () => ({ invert: true }),
    setProperties: vi.fn(),
    getPan: () => [2, 3],
    setPan: vi.fn(),
    getZoom: () => zoom,
    setZoom: (value: number) => {
      zoom = value;
    },
    render: vi.fn(),
  } as unknown as StackViewport;
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
  const source = {
    initialIndex: 0,
    request: vi.fn((index: number) =>
      index === 0
        ? Promise.resolve('first')
        : new Promise<string>(resolve => {
            release = resolve;
          })
    ),
  } as unknown as ProgressiveDicomSeries;
  const target = {
    element: document.createElement('div'),
    setStack: vi.fn().mockResolvedValue(undefined),
    getProperties: () => ({}),
    setProperties: vi.fn(),
    getPan: () => [0, 0],
    getZoom: () => 1,
    setPan: vi.fn(),
    setZoom: vi.fn(),
    render: vi.fn(),
  } as unknown as StackViewport;
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
