import { describe, expect, it, vi } from 'vitest';
import type { StackViewport } from '@cornerstonejs/core';
vi.mock('@/services/radiology/dicomRenderReady', () => ({
  waitForDicomRender: async (_: unknown, render: () => void) => render(),
}));
import { openDicomCineSession } from '@/services/radiology/dicomCineSession';
import type { createProgressiveStack } from '@/services/radiology/dicomProgressiveStack';

const setup = () => {
  const pane = document.createElement('div');
  const element = document.createElement('div');
  pane.append(element);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  let state = { current: 5 as number | null, requested: 5, pending: false, error: '' };
  const stack = {
    state: () => state,
    lock: vi.fn(),
    select: vi.fn(),
    selectAndWait: vi.fn(async (index: number) => {
      state = { ...state, current: index, requested: index };
    }),
  };
  const target = { element, getCanvas: () => canvas, render: vi.fn() };
  const open = (restoreSlice?: boolean) =>
    openDicomCineSession(
      target as unknown as StackViewport,
      stack as unknown as ReturnType<typeof createProgressiveStack>,
      new AbortController().signal,
      () => undefined,
      {
        total: 24,
        orientation: () => ({ top: 'A', right: 'L', bottom: 'P', left: 'R' }),
        restoreSlice,
      }
    );
  return { stack, open, canvas };
};

describe('original cine session', () => {
  it('labels each verified cut and returns to the cut shown before an MP4 export', async () => {
    const { stack, open, canvas } = setup();
    const session = open(true);
    const frame = await session.frame(9, new AbortController().signal);
    expect(frame).toEqual({
      canvas,
      label: 'Corte 10/24',
      edges: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
    });
    await session.frame(10, new AbortController().signal);
    session.close();
    expect(stack.select).toHaveBeenLastCalledWith(5);
    expect(stack.lock.mock.calls).toEqual([[true], [false]]);
  });
  it('keeps playback on its last cut', async () => {
    const { stack, open } = setup();
    const session = open();
    await session.frame(9, new AbortController().signal);
    session.close();
    expect(stack.select).toHaveBeenLastCalledWith(9);
  });
});
