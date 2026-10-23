import { describe, expect, it } from 'vitest';
import type { SliceGeometry } from '@/domain/radiology/dicomGeometry';
import {
  comparisonPlane,
  comparisonReferenceLine,
  nearestComparisonSlice,
} from '@/services/radiology/dicomComparisonGeometry';
const axial = (z: number, patch: Partial<SliceGeometry> = {}): SliceGeometry => ({
  imageId: `synthetic-${z}`,
  position: [0, 0, z],
  orientation: [1, 0, 0, 0, 1, 0],
  spacing: [1, 1],
  frame: 'synthetic-frame',
  rows: 64,
  columns: 64,
  ...patch,
});
describe('patient-space comparison', () => {
  it('maps different and reversed sampling to the closest physical slice, not index', () => {
    expect(nearestComparisonSlice(axial(4), [axial(9), axial(6), axial(3), axial(0)])).toBe(2);
    expect(nearestComparisonSlice(axial(6), [axial(0), axial(6), axial(12)])).toBe(1);
    expect(nearestComparisonSlice(axial(-1), [axial(0), axial(6)])).toBeNull();
    expect(nearestComparisonSlice(axial(7), [axial(0), axial(6)])).toBeNull();
  });
  it.each([
    { frame: '' },
    { frame: 'other' },
    { position: [NaN, 0, 0] },
    { orientation: [1, 0, 0, 0, 0, 1] },
    { orientation: [2, 0, 0, 0, 1, 0] },
    { spacing: [0, 1] },
    { rows: -1 },
    { position: [1000, 0, 0] },
  ])('rejects invalid, foreign or uncovered geometry %j', patch => {
    expect(nearestComparisonSlice(axial(0), [axial(0, patch)])).toBeNull();
  });
  it('accepts heterogeneous matrices covering the same anatomy', () => {
    expect(
      nearestComparisonSlice(axial(2), [
        axial(0, { rows: 32, columns: 32, spacing: [2, 2] }),
        axial(3, { rows: 32, columns: 32, spacing: [2, 2] }),
      ])
    ).toBe(1);
  });
  it('rejects a localizer mixed into the target series', () => {
    expect(
      nearestComparisonSlice(axial(1), [
        axial(0),
        axial(1, { orientation: [1, 0, 0, 0, 0, 1] }),
        axial(2),
      ])
    ).toBeNull();
  });
  it('validates source orientation and empty targets', () => {
    expect(comparisonPlane(axial(1, { orientation: [] }))).toBeNull();
    expect(nearestComparisonSlice(axial(1), [])).toBeNull();
  });
  it('draws an exact plane intersection and rejects parallel or foreign frames', () => {
    const coronal = axial(0, { position: [0, 10, 0], orientation: [1, 0, 0, 0, 0, 1] });
    const line = comparisonReferenceLine(axial(20), coronal)!;
    expect(line).toHaveLength(2);
    line.forEach(point => {
      expect(point[1]).toBe(10);
      expect(point[2]).toBe(20);
    });
    expect(line.map(point => point[0]).sort((a, b) => a - b)).toEqual([0, 63]);
    expect(comparisonReferenceLine(axial(80), coronal)).toBeNull();
    expect(comparisonReferenceLine(axial(2), axial(3))).toBeNull();
    expect(comparisonReferenceLine(axial(20), { ...coronal, frame: 'other' })).toBeNull();
  });
});
