import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VolumeViewport } from '@cornerstonejs/core';

const render = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
}));
vi.mock('@cornerstonejs/core', () => ({
  utilities: {
    getVolumeViewportScrollInfo: (viewport: { step: number; steps: number }) => ({
      currentStepIndex: viewport.step,
      numScrollSteps: viewport.steps - 1,
    }),
    scroll: (
      viewport: { step: number; steps: number; moveTo: (step: number) => void },
      options: { delta: number }
    ) => viewport.moveTo(Math.max(0, Math.min(viewport.steps - 1, viewport.step + options.delta))),
  },
}));
vi.mock('@/services/radiology/dicomRenderReady', () => ({
  waitForDicomRender: async (_: unknown, draw: () => void, signal: AbortSignal) => {
    signal.throwIfAborted();
    draw();
    await render.gate;
    signal.throwIfAborted();
  },
}));
// The measurement overlay reads Cornerstone's SVG layer, which the e2e suite covers.
vi.mock('@/services/radiology/dicomMeasurementOverlay', () => ({
  measurementOverlayAfterRender: async () => null,
}));
import {
  describeDicomPlaneSlices,
  openDicomVolumeVideo,
  type DicomVideoRequest,
} from '@/services/radiology/dicomVolumeVideo';

const camera = (z: number) => ({
  focalPoint: [0, 0, z],
  position: [0, 0, z + 100],
  viewUp: [0, 1, 0],
  viewPlaneNormal: [0, 0, 1],
  parallelScale: 40,
});
/** One synthetic plane: the camera's z is its slice, as wheel steps would place it. */
const viewport = (steps = 10, start = 4) => {
  const pane = document.createElement('div');
  const element = document.createElement('div');
  pane.append(element);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 48;
  const view = {
    element,
    pane,
    canvas,
    steps,
    step: start,
    visited: [] as number[],
    current: camera(start) as ReturnType<typeof camera>,
    getVolumeId: () => 'synthetic-volume',
    getCanvas: () => canvas,
    getCamera: () => view.current,
    moveTo: (step: number) => {
      view.step = step;
      view.current = camera(step);
    },
    setCamera: vi.fn((next: Partial<ReturnType<typeof camera>>) => {
      view.current = { ...view.current, ...next };
      view.step = view.current.focalPoint[2];
    }),
    render: vi.fn(() => view.visited.push(view.step)),
  };
  return view;
};
const open = (view: ReturnType<typeof viewport>, request: DicomVideoRequest, active = vi.fn()) => {
  const release = vi.fn();
  const hold = vi.fn(() => release);
  const session = openDicomVolumeVideo({
    viewport: view as unknown as VolumeViewport,
    request,
    lockElements: [view.pane],
    signal: new AbortController().signal,
    ensureActive: active,
    hold,
    describe: (position, total) => `Axial · MIP · 10 mm · Corte ${position + 1}/${total}`,
    edges: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
  });
  return { session, hold, release };
};
const wheel = (target: HTMLElement) => {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
beforeEach(() => {
  render.gate = undefined;
});

describe('MPR sweep', () => {
  it('renders each requested slice in order and restores the slice, camera and input', async () => {
    const view = viewport();
    const { session, hold, release } = open(view, { kind: 'mpr', plane: 0 });
    expect(session.total).toBe(10);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(wheel(view.element)).toBe(true);
    const frames = [];
    for (const position of [2, 3, 4, 5, 4, 3])
      frames.push(await session.frame(position, new AbortController().signal));
    expect(view.visited).toEqual([2, 3, 4, 5, 4, 3]);
    expect(frames.map(frame => frame.label)).toEqual([
      'Axial · MIP · 10 mm · Corte 3/10',
      'Axial · MIP · 10 mm · Corte 4/10',
      'Axial · MIP · 10 mm · Corte 5/10',
      'Axial · MIP · 10 mm · Corte 6/10',
      'Axial · MIP · 10 mm · Corte 5/10',
      'Axial · MIP · 10 mm · Corte 4/10',
    ]);
    expect(frames[0]).toMatchObject({ canvas: view.canvas, edges: { top: 'A' } });
    session.close();
    session.close();
    expect(view.current).toEqual(camera(4));
    expect(view.setCamera).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(wheel(view.element)).toBe(false);
    await expect(session.frame(1, new AbortController().signal)).rejects.toThrow(
      'no está disponible'
    );
  });
  it('refuses positions outside the plane and a plane whose slice count changed', async () => {
    const view = viewport();
    const { session } = open(view, { kind: 'mpr', plane: 0 });
    await expect(session.frame(10, new AbortController().signal)).rejects.toThrow('intervalo');
    await expect(session.frame(1.5, new AbortController().signal)).rejects.toThrow('intervalo');
    view.steps = 12;
    await expect(session.frame(2, new AbortController().signal)).rejects.toThrow('cambió');
    session.close();
    expect(view.current).toEqual(camera(4));
  });
  it('stops a cancelled frame without capturing it and still restores the view', async () => {
    const view = viewport();
    const { session, release } = open(view, { kind: 'mpr', plane: 0 });
    let draw!: () => void;
    render.gate = new Promise(resolve => {
      draw = resolve;
    });
    const controller = new AbortController();
    const pending = session.frame(8, controller.signal);
    controller.abort();
    draw();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    session.close();
    expect(view.current).toEqual(camera(4));
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('rejects a resized view and skips restoring a closed viewer', async () => {
    const view = viewport();
    const active = vi.fn();
    const { session, release } = open(view, { kind: 'mpr', plane: 0 }, active);
    view.canvas.width = 32;
    await expect(session.frame(5, new AbortController().signal)).rejects.toThrow('tamaño');
    active.mockImplementation(() => {
      throw new Error('El visor está cerrado.');
    });
    session.close();
    expect(view.setCamera).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('describes the current slice and count of a plane', () => {
    expect(describeDicomPlaneSlices(viewport(24, 11) as unknown as VolumeViewport)).toEqual({
      current: 11,
      total: 24,
    });
    expect(describeDicomPlaneSlices(undefined)).toBeNull();
  });
});

describe('3D turntable', () => {
  it('orbits from the saved camera for every angle and puts that camera back', async () => {
    const view = viewport();
    const saved = structuredClone(view.current);
    const { session } = open(view, { kind: '3d', axis: 'vertical' });
    expect(session.total).toBe(0);
    for (const angle of [0, 90, 180, 270]) await session.frame(angle, new AbortController().signal);
    const positions = view.setCamera.mock.calls.map(([next]) =>
      next.position!.map(value => Math.round(value) + 0)
    );
    expect(positions).toEqual([
      [0, 0, 104],
      [100, 0, 4],
      [0, 0, -96],
      [-100, 0, 4],
    ]);
    session.close();
    expect(view.setCamera).toHaveBeenLastCalledWith(saved);
    expect(view.current).toEqual(saved);
  });
});
