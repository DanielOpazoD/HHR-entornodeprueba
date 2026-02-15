import { describe, expect, it } from 'vitest';
import { resolveDeviceMenuPosition } from '@/components/device-selector/deviceMenuPositionController';

describe('deviceMenuPositionController', () => {
  it('positions menu below anchor when there is enough space', () => {
    const position = resolveDeviceMenuPosition({
      anchorRect: { top: 100, bottom: 128, left: 40 },
      viewportWidth: 1200,
      viewportHeight: 900,
    });

    expect(position).toEqual({
      top: 136,
      left: 40,
      placement: 'bottom',
    });
  });

  it('positions menu above when below space is constrained', () => {
    const position = resolveDeviceMenuPosition({
      anchorRect: { top: 700, bottom: 730, left: 100 },
      viewportWidth: 1200,
      viewportHeight: 900,
      menuMaxHeight: 300,
    });

    expect(position).toEqual({
      top: 692,
      left: 100,
      placement: 'top',
    });
  });

  it('clamps horizontal position to viewport padding', () => {
    const leftClamped = resolveDeviceMenuPosition({
      anchorRect: { top: 100, bottom: 120, left: 2 },
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    const rightClamped = resolveDeviceMenuPosition({
      anchorRect: { top: 100, bottom: 120, left: 1190 },
      viewportWidth: 1200,
      viewportHeight: 800,
      menuWidth: 360,
      viewportPadding: 12,
    });

    expect(leftClamped.left).toBe(12);
    expect(rightClamped.left).toBe(828);
  });
});
