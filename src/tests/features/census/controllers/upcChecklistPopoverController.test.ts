import { describe, it, expect } from 'vitest';
import { resolveUpcChecklistPopoverPosition } from '@/features/census/controllers/upcChecklistPopoverController';

const makeRect = (top: number, left: number, width: number, height: number): DOMRect =>
  ({
    top,
    left,
    bottom: top + height,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe('resolveUpcChecklistPopoverPosition', () => {
  it.each([96, 128, 170])(
    'never overlaps toolbar bottom %s when opening upwards',
    toolbarBottom => {
      const pos = resolveUpcChecklistPopoverPosition({
        buttonRect: makeRect(600, 1100, 50, 20),
        viewportWidth: 1366,
        viewportHeight: 768,
        panelHeight: 560,
        toolbarBottom,
      });
      expect(pos.top).toBe(toolbarBottom + 8);
      expect(pos.top + 560).toBeLessThanOrEqual(760);
    }
  );

  it('reserves the toolbar space even when the panel must scroll in a short viewport', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(420, 1100, 50, 20),
      viewportWidth: 1280,
      viewportHeight: 600,
      panelHeight: 560,
      toolbarBottom: 128,
    });
    expect(pos.top).toBe(136);
  });

  it('places popover below the button when there is enough space', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(100, 200, 50, 20),
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(pos.top).toBe(124); // bottom (120) + 4
    expect(pos.left).toBe(200);
  });

  it('places popover above when not enough space below', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(600, 200, 50, 20),
      viewportWidth: 1280,
      viewportHeight: 700,
    });
    expect(pos.top).toBe(36); // top (600) - estimated height (560) - gap (4)
  });

  it('clamps left to viewport edge when button is too far right', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(100, 1100, 50, 20),
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    // 1280 - 520 - 8 = 752
    expect(pos.left).toBe(752);
  });

  it('clamps top to viewport padding when button is near top', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(10, 200, 50, 20),
      viewportWidth: 1280,
      viewportHeight: 100, // very small viewport
    });
    expect(pos.top).toBe(8); // VIEWPORT_PADDING
  });

  it('clamps left to viewport padding when button is at left edge', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(100, 2, 50, 20),
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(pos.left).toBe(8); // VIEWPORT_PADDING
  });
  it.each([-500, 1500])(
    'keeps the measured panel in view when the anchor is offscreen at %s',
    top => {
      const pos = resolveUpcChecklistPopoverPosition({
        buttonRect: makeRect(top, 1100, 50, 20),
        viewportWidth: 1366,
        viewportHeight: 768,
        panelHeight: 480,
      });
      expect(pos.top).toBeGreaterThanOrEqual(8);
      expect(pos.top + 480).toBeLessThanOrEqual(760);
    }
  );
  it('uses the measured height instead of reserving unnecessary space', () => {
    const pos = resolveUpcChecklistPopoverPosition({
      buttonRect: makeRect(220, 400, 50, 20),
      viewportWidth: 1366,
      viewportHeight: 768,
      panelHeight: 480,
    });
    expect(pos.top).toBe(244);
  });
});
