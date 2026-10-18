import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    Events: { CAMERA_MODIFIED: 'camera' },
    BlendModes: {
      COMPOSITE: 0,
      MAXIMUM_INTENSITY_BLEND: 1,
      MINIMUM_INTENSITY_BLEND: 2,
      AVERAGE_INTENSITY_BLEND: 3,
    },
  },
}));
import { createMprReconstruction } from '@/services/radiology/dicomMprReconstruction';
import { planDicomVolume } from '@/domain/radiology/dicomGeometry';
const plan = planDicomVolume(
  Array.from({ length: 10 }, (_, z) => ({
    imageId: `s-${z}`,
    frame: 'synthetic',
    rows: 10,
    columns: 10,
    spacing: [1, 1],
    position: [0, 0, z * 2],
    orientation: [1, 0, 0, 0, 1, 0],
  }))
);
const setup = () => {
  const views = [0, 1, 2].map(i => ({
    element: document.createElement('div'),
    getCamera: () => ({
      focalPoint: [4.5, 4.5, 9],
      viewPlaneNormal: i === 0 ? [0, 0, 1] : i === 1 ? [0, 1, 0] : [1, 0, 0],
      viewUp: [0, 1, 0],
    }),
    setBlendMode: vi.fn(),
    setSlabThickness: vi.fn(),
    resetSlabThickness: vi.fn(),
    setOrientation: vi.fn(),
  }));
  const engine = { getViewport: (id: string) => views[Number(id)], renderViewports: vi.fn() };
  const crosshairs = { toolCenter: [4.5, 4.5, 9], resetCrosshairs: vi.fn() };
  const notify = vi.fn();
  const controller = createMprReconstruction(
    engine as unknown as Parameters<typeof createMprReconstruction>[0],
    ['0', '1', '2'],
    plan,
    crosshairs as unknown as Parameters<typeof createMprReconstruction>[3],
    notify
  );
  return { controller, views, notify, crosshairs };
};
beforeEach(() => vi.clearAllMocks());
it.each([
  ['average', 3],
  ['mip', 1],
  ['minip', 2],
] as const)(
  'uses full physical width and %s projection without changing geometry',
  (mode, blend) => {
    const { controller, views } = setup();
    controller.update({ thickness: 12, mode });
    for (const view of views) {
      expect(view.setSlabThickness).toHaveBeenCalledWith(6);
      expect(view.setBlendMode).toHaveBeenCalledWith(blend);
      expect(view.setOrientation).not.toHaveBeenCalled();
    }
    expect(controller.state().quantitative).toBe(false);
    expect(controller.state().planes[1].clipped).toBe(true);
    controller.dispose();
  }
);
it('resets projection and orientations and restores quantitative eligibility', () => {
  const { controller, views, crosshairs } = setup();
  controller.update({ thickness: 12, mode: 'mip', rotate: true });
  controller.reset();
  expect(controller.state()).toMatchObject({
    thickness: 0,
    rotate: false,
    mode: 'average',
    quantitative: true,
  });
  expect(crosshairs.resetCrosshairs).toHaveBeenCalledOnce();
  for (const view of views) {
    expect(view.setBlendMode).toHaveBeenLastCalledWith(0);
    expect(view.resetSlabThickness).toHaveBeenCalled();
    expect(view.setOrientation).toHaveBeenCalledOnce();
  }
  controller.dispose();
});
it('rejects invalid settings atomically and removes camera listeners on close', () => {
  const { controller, views, notify } = setup();
  expect(() => controller.update({ thickness: NaN })).toThrow();
  expect(controller.state().thickness).toBe(0);
  controller.dispose();
  notify.mockClear();
  views[0].element.dispatchEvent(new Event('camera'));
  expect(notify).not.toHaveBeenCalled();
});
