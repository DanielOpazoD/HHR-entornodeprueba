import { describe, expect, it } from 'vitest';

import {
  RADIAL_VIEW_RADIUS,
  radialLabelPath,
  resolveRadialCenter,
} from '@/features/census/components/patient-row/clinicalAccessRadialGeometry';

const viewport = { width: 1280, height: 832 };
const button = (left: number, top: number) => ({ left, top, width: 30, height: 30 });

describe('clinicalAccessRadialGeometry', () => {
  it('centres the ring on its button when it fits on screen', () => {
    expect(resolveRadialCenter(button(400, 300), viewport)).toEqual({ x: 415, y: 315 });
  });

  it('moves the ring in only as far as needed near an edge', () => {
    const reach = RADIAL_VIEW_RADIUS + 10;
    expect(resolveRadialCenter(button(0, 10), viewport)).toEqual({ x: reach, y: reach });
    expect(resolveRadialCenter(button(1270, 820), viewport)).toEqual({
      x: viewport.width - reach,
      y: viewport.height - reach,
    });
  });

  it('writes the bottom label the other way round so it never reads upside down', () => {
    // Clockwise arcs use sweep 1; the bottom one runs counter-clockwise, from right to left.
    expect(radialLabelPath('ficha')).toMatch(/ 0 0 1 /);
    expect(radialLabelPath('imaging')).toMatch(/ 0 0 0 /);
  });
});
