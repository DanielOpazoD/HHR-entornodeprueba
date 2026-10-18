import { beforeEach, expect, it, vi } from 'vitest';
import type { RenderingEngine } from '@cornerstonejs/core';
vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack' },
    Events: { CAMERA_MODIFIED: 'camera', VOI_MODIFIED: 'voi' },
  },
}));
vi.mock('@/services/radiology/dicomRenderReady', () => ({
  waitForDicomRender: async (_: unknown, render: () => void) => render(),
}));
const contexts = vi.hoisted(() => vi.fn());
vi.mock('@/services/radiology/dicomGraphicsResources', () => ({ dicomGraphicsContexts: contexts }));
import { createDicomViewContinuity } from '@/services/radiology/dicomViewContinuity';
const setup = () => {
  const controller = new AbortController();
  const canvas = new EventTarget();
  contexts.mockReturnValue([{ canvas, isContextLost: () => false }]);
  const element = document.createElement('div');
  document.body.append(element);
  let camera = { focalPoint: [1, 2, 3], parallelScale: 12 };
  let properties = { voiRange: { lower: -100, upper: 200 } };
  const view = {
    element,
    getCamera: () => camera,
    getProperties: () => properties,
    setCamera: vi.fn(value => {
      camera = value;
    }),
    setProperties: vi.fn(value => {
      properties = value;
    }),
  };
  const engine = { getViewports: () => [view], render: vi.fn() };
  const replace = vi.fn(async () => {});
  const invalidate = vi.fn();
  const restored = vi.fn(() => view.getCamera());
  const continuity = createDicomViewContinuity(
    () => engine as unknown as RenderingEngine,
    replace,
    controller.signal,
    invalidate,
    restored
  );
  const states: string[] = [];
  continuity.subscribe(state => states.push(state));
  const build = vi.fn(async () => {
    camera = { focalPoint: [0, 0, 0], parallelScale: 1 };
  });
  return {
    controller,
    canvas,
    element,
    view,
    engine,
    replace,
    invalidate,
    restored,
    continuity,
    states,
    build,
  };
};
beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});
it('restores camera and VOI after loss without requesting images again', async () => {
  const s = setup();
  await s.continuity.show('mpr', [s.element], s.build);
  s.view.setCamera({ focalPoint: [7, 8, 9], parallelScale: 42 });
  s.element.dispatchEvent(new Event('camera'));
  s.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  await vi.waitFor(() => expect(s.states.at(-1)).toBe('ready'));
  expect(s.replace).toHaveBeenCalledTimes(1);
  expect(s.view.getCamera()).toEqual({ focalPoint: [7, 8, 9], parallelScale: 42 });
  expect(s.view.getProperties().voiRange).toEqual({ lower: -100, upper: 200 });
  // Recompute linked geometry only after all saved cameras have been restored.
  expect(s.restored.mock.results.at(-1)?.value).toEqual({
    focalPoint: [7, 8, 9],
    parallelScale: 42,
  });
  expect(s.element.style.visibility).toBe('');
  s.continuity.dispose();
});
it('bounds automatic recovery and keeps failed images hidden', async () => {
  const s = setup();
  await s.continuity.show('original', [s.element], s.build);
  for (let i = 0; i < 2; i++) {
    s.canvas.dispatchEvent(new Event('webglcontextlost'));
    await vi.waitFor(() => expect(s.states.at(-1)).toBe('ready'));
  }
  s.canvas.dispatchEvent(new Event('webglcontextlost'));
  await vi.waitFor(() => expect(s.states.at(-1)).toBe('failed'));
  expect(s.replace).toHaveBeenCalledTimes(2);
  expect(s.invalidate).toHaveBeenCalledTimes(3);
  expect(s.element.style.visibility).toBe('hidden');
  s.continuity.dispose();
});
it('removes context listeners on suspend and close', async () => {
  const s = setup();
  await s.continuity.show('original', [s.element], s.build);
  await s.continuity.suspend();
  s.canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(s.replace).not.toHaveBeenCalled();
  await s.continuity.show('mpr', [s.element], s.build);
  s.continuity.dispose();
  s.canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(s.replace).not.toHaveBeenCalled();
});
it('does not recover an aborted patient session', async () => {
  const s = setup();
  await s.continuity.show('mpr', [s.element], s.build);
  s.controller.abort();
  s.canvas.dispatchEvent(new Event('webglcontextlost'));
  await Promise.resolve();
  expect(s.replace).not.toHaveBeenCalled();
  s.continuity.dispose();
});
it('serializes display transitions and restores only the matching mode', async () => {
  const s = setup();
  await s.continuity.show('original', [s.element], s.build);
  s.view.setCamera({ focalPoint: [4, 5, 6], parallelScale: 20 });
  s.element.dispatchEvent(new Event('camera'));
  await s.continuity.show('mpr', [s.element], s.build);
  expect(s.view.getCamera().parallelScale).toBe(1);
  await s.continuity.show('original', [s.element], s.build);
  expect(s.view.getCamera().parallelScale).toBe(20);
  s.continuity.dispose();
});

it('does not restore the previous image plane when a new requested cut becomes ready', async () => {
  const s = setup();
  let imageId = 'slice-before';
  const setPan = vi.fn(),
    setZoom = vi.fn();
  Object.assign(s.view, {
    type: 'stack',
    getCurrentImageId: () => imageId,
    getPan: () => [3, 4],
    getZoom: () => 2,
    setPan,
    setZoom,
  });
  await s.continuity.show('original', [s.element], s.build);
  s.view.setCamera.mockClear();
  s.build.mockImplementation(async () => {
    imageId = 'slice-requested';
  });
  s.canvas.dispatchEvent(new Event('webglcontextlost'));
  await vi.waitFor(() => expect(s.replace).toHaveBeenCalledTimes(1));
  expect(setPan).toHaveBeenCalledWith([3, 4]);
  expect(setZoom).toHaveBeenCalledWith(2);
  expect(s.view.setCamera).not.toHaveBeenCalled();
  s.continuity.dispose();
});

it('ignores camera changes from detached panes during a React mode transition', async () => {
  const s = setup();
  await s.continuity.show('mpr', [s.element], s.build);
  s.view.setCamera({ focalPoint: [7, 8, 9], parallelScale: 42 });
  s.element.dispatchEvent(new Event('camera'));
  s.element.remove();
  s.view.setCamera({ focalPoint: [0, 0, 0], parallelScale: 1 });
  s.element.dispatchEvent(new Event('camera'));
  const next = document.createElement('div');
  document.body.append(next);
  await s.continuity.show('mpr', [next], async () => {
    s.view.element = next;
  });
  expect(s.view.getCamera()).toEqual({ focalPoint: [7, 8, 9], parallelScale: 42 });
  s.continuity.dispose();
});
it('keeps the last valid mode snapshot when a different mode failed to build', async () => {
  const s = setup();
  await s.continuity.show('mpr', [s.element], s.build);
  s.view.setCamera({ focalPoint: [7, 8, 9], parallelScale: 42 });
  s.element.dispatchEvent(new Event('camera'));
  await s.continuity.show('original', [s.element], s.build);
  await expect(
    s.continuity.show('mpr', [s.element], async () => {
      throw new Error('synthetic geometry failure');
    })
  ).rejects.toThrow('synthetic geometry failure');
  await s.continuity.show('mpr', [s.element], s.build);
  expect(s.view.getCamera().parallelScale).toBe(42);
  s.continuity.dispose();
});
