import type { SliceGeometry } from '@/domain/radiology/dicomGeometry';

const positive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * ABC/2 for intracerebral haemorrhage: A is the longest diameter, B the perpendicular diameter
 * on the same slice, and C the number of slices with haemorrhage times the slice interval.
 * Inputs in mm; an estimate, never a volumetry.
 */
export const estimateAbcHalf = (input: {
  a: number;
  b: number;
  slices: number;
  thickness: number;
}) => {
  const { a, b, slices, thickness } = input;
  if (![a, b, thickness].every(positive) || !Number.isInteger(slices) || slices < 1)
    return undefined;
  const c = slices * thickness;
  const cubicMm = (a * b * c) / 2;
  return { c, cubicMm, ml: cubicMm / 1000 };
};

/** Ellipsoid π/6·a·b·c from three orthogonal diameters in mm. */
export const estimateEllipsoid = (input: { a: number; b: number; c: number }) => {
  const { a, b, c } = input;
  if (![a, b, c].every(positive)) return undefined;
  const cubicMm = (Math.PI / 6) * a * b * c;
  return { cubicMm, ml: cubicMm / 1000 };
};

/** Angle in degrees between two segments, 0–90: how perpendicular A and B are. */
export const dicomSegmentAngle = (first: number[][], second: number[][]) => {
  const vector = (points: number[][]) =>
    points.length >= 2 && points.every(point => point.length >= 3 && point.every(Number.isFinite))
      ? [0, 1, 2].map(axis => points[1][axis] - points[0][axis])
      : undefined;
  const [u, v] = [vector(first), vector(second)];
  if (!u || !v) return undefined;
  const length = (w: number[]) => Math.hypot(w[0], w[1], w[2]);
  const scale = length(u) * length(v);
  if (!scale) return undefined;
  const cosine = Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / scale;
  return (Math.acos(Math.min(1, cosine)) * 180) / Math.PI;
};

/**
 * Distance between consecutive slices along their normal, from Image Position and Orientation.
 * Undefined when positions are missing, repeated or unevenly spaced: the user enters it then.
 */
export const dicomSliceInterval = (slices: Array<SliceGeometry | undefined>) => {
  const usable = slices.filter(
    (slice): slice is SliceGeometry =>
      !!slice && slice.position.length === 3 && slice.orientation.length === 6
  );
  if (usable.length < 2 || usable.length !== slices.length) return undefined;
  const [r, c] = [usable[0].orientation.slice(0, 3), usable[0].orientation.slice(3)];
  const normal = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
  const size = Math.hypot(...normal);
  if (!positive(size)) return undefined;
  const along = usable
    .map(slice => slice.position.reduce((sum, value, axis) => sum + value * normal[axis], 0) / size)
    .sort((x, y) => x - y);
  const gaps = along.slice(1).map((value, index) => value - along[index]);
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (!positive(mean) || gaps.some(gap => Math.abs(gap - mean) > Math.max(0.01, mean * 0.01)))
    return undefined;
  return mean;
};
