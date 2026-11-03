import { describe, expect, it } from 'vitest';
import {
  dicomSegmentAngle,
  dicomSliceInterval,
  estimateAbcHalf,
  estimateEllipsoid,
} from '@/services/radiology/dicomVolumeEstimates';

describe('ABC/2', () => {
  it('multiplies the diameters by the haemorrhage extent and halves it', () => {
    // 5 cm × 4 cm × (10 slices × 5 mm) / 2 = 50 mL.
    expect(estimateAbcHalf({ a: 50, b: 40, slices: 10, thickness: 5 })).toEqual({
      c: 50,
      cubicMm: 50_000,
      ml: 50,
    });
    expect(estimateAbcHalf({ a: 24, b: 20, slices: 5, thickness: 2 })?.ml).toBeCloseTo(2.4);
  });

  it.each([
    { a: 0, b: 40, slices: 10, thickness: 5 },
    { a: 50, b: -1, slices: 10, thickness: 5 },
    { a: 50, b: 40, slices: 0, thickness: 5 },
    { a: 50, b: 40, slices: 2.5, thickness: 5 },
    { a: 50, b: 40, slices: 10, thickness: Number.NaN },
  ])('gives no estimate for incomplete input %o', input => {
    expect(estimateAbcHalf(input)).toBeUndefined();
  });
});

describe('ellipsoid', () => {
  it('is π/6 times the three diameters', () => {
    const result = estimateEllipsoid({ a: 30, b: 20, c: 10 });
    expect(result?.cubicMm).toBeCloseTo((Math.PI / 6) * 6000);
    expect(result?.ml).toBeCloseTo(3.1416, 3);
    // A sphere of 20 mm diameter: 4/3·π·10³ mm³.
    expect(estimateEllipsoid({ a: 20, b: 20, c: 20 })?.cubicMm).toBeCloseTo(
      (4 / 3) * Math.PI * 1000
    );
    expect(estimateEllipsoid({ a: 20, b: 0, c: 20 })).toBeUndefined();
  });
});

describe('inputs from the geometry', () => {
  const slice = (z: number, orientation = [1, 0, 0, 0, 1, 0]) => ({
    imageId: `synthetic-${z}`,
    position: [0, 0, z],
    orientation,
    spacing: [1, 1],
    frame: 'synthetic-frame',
    rows: 64,
    columns: 64,
  });

  it('measures the slice interval along the normal, in any acquisition order', () => {
    expect(dicomSliceInterval([4, 0, 2, 6].map(z => slice(z)))).toBeCloseTo(2);
    // Coronal slices advance along Y.
    expect(
      dicomSliceInterval(
        [0, 3, 6].map(y => ({ ...slice(0, [1, 0, 0, 0, 0, -1]), position: [0, y, 0] }))
      )
    ).toBeCloseTo(3);
  });

  it('asks the clinician when the interval is uneven, repeated or missing', () => {
    expect(dicomSliceInterval([0, 2, 5].map(z => slice(z)))).toBeUndefined();
    expect(dicomSliceInterval([0, 0, 2].map(z => slice(z)))).toBeUndefined();
    expect(dicomSliceInterval([slice(0), undefined, slice(4)])).toBeUndefined();
    expect(dicomSliceInterval([slice(0)])).toBeUndefined();
    expect(dicomSliceInterval([{ ...slice(0), orientation: [] }, slice(2)])).toBeUndefined();
  });

  it('reports how perpendicular two diameters are', () => {
    const a = [
      [0, 0, 0],
      [10, 0, 0],
    ];
    expect(
      dicomSegmentAngle(a, [
        [0, 0, 0],
        [0, 5, 0],
      ])
    ).toBeCloseTo(90);
    expect(
      dicomSegmentAngle(a, [
        [0, 0, 0],
        [5, 5, 0],
      ])
    ).toBeCloseTo(45);
    expect(
      dicomSegmentAngle(a, [
        [0, 0, 0],
        [-5, 0, 0],
      ])
    ).toBeCloseTo(0);
    expect(
      dicomSegmentAngle(a, [
        [1, 1, 1],
        [1, 1, 1],
      ])
    ).toBeUndefined();
  });
});
