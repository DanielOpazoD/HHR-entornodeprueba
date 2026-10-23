import { describe, it, expect } from 'vitest';
import { planDicomVolume } from '@/domain/radiology/dicomGeometry';
import {
  defaultMprSettings,
  validateMprSettings,
  slabCoverage,
  isObliqueNormal,
} from '@/domain/radiology/dicomReconstruction';

const plan = planDicomVolume(
  Array.from({ length: 5 }, (_, z) => ({
    imageId: `synthetic-${z}`,
    frame: 'synthetic',
    rows: 8,
    columns: 10,
    position: [10, 20, 30 + z * 3],
    spacing: [2, 0.5],
    orientation: [1, 0, 0, 0, 1, 0],
  }))
);
describe('physical reconstruction contract', () => {
  it('uses anisotropic pixel-edge bounds and full millimetres, independent of matrix counts', () => {
    expect(slabCoverage(plan, [12, 24, 36], [0, 0, 1], 10)).toBeCloseTo(10);
    expect(slabCoverage(plan, [12, 24, 30], [0, 0, 1], 10)).toBeCloseTo(6.5);
    expect(slabCoverage(plan, [12, 24, 36], [1, 0, 0], 10)).toBeCloseTo(5);
    expect(slabCoverage(plan, [99, 24, 36], [0, 0, 1], 10)).toBe(0);
  });
  it('respects rotated acquisition axes and oblique ray intersections', () => {
    const rotated = {
      ...plan,
      origin: [10, 20, 30] as [number, number, number],
      direction: [0, 1, 0, 0, 0, 1, 1, 0, 0],
    };
    expect(slabCoverage(rotated, [16, 22, 34], [1, 0, 0], 10)).toBeCloseTo(10);
    const n = [Math.SQRT1_2, 0, Math.SQRT1_2];
    expect(slabCoverage(plan, [12, 24, 36], n, 20)).toBeCloseTo(5 * Math.SQRT2);
  });
  it.each([NaN, Infinity, -1, 0.1, 51])('rejects unsupported thickness %s', thickness => {
    expect(() => validateMprSettings({ ...defaultMprSettings(), thickness })).toThrow();
  });
  it('distinguishes a real oblique plane from rounding of an orthogonal direction', () => {
    expect(isObliqueNormal([0, 0, -1])).toBe(false);
    expect(isObliqueNormal([Math.SQRT1_2, Math.SQRT1_2, 0])).toBe(true);
  });
});
