import type { SliceGeometry } from '@/domain/radiology/dicomGeometry';

export const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const finite = (values: number[], length: number) =>
  values.length === length && values.every(Number.isFinite);

/** Only original, verified patient-space geometry; no registration or index-based fallback. */
export const comparisonPlane = (slice: SliceGeometry) => {
  if (
    !slice.frame ||
    !finite(slice.position, 3) ||
    !finite(slice.orientation, 6) ||
    !finite(slice.spacing, 2) ||
    slice.spacing.some(value => value <= 0) ||
    ![slice.rows, slice.columns].every(value => Number.isSafeInteger(value) && value > 0)
  )
    return null;
  const row = slice.orientation.slice(0, 3),
    column = slice.orientation.slice(3);
  if (
    Math.abs(dot(row, row) - 1) > 0.001 ||
    Math.abs(dot(column, column) - 1) > 0.001 ||
    Math.abs(dot(row, column)) > 0.001
  )
    return null;
  const normal = cross(row, column);
  const length = Math.sqrt(dot(normal, normal));
  return { row, column, normal: normal.map(value => value / length) };
};

export const nearestComparisonSlice = (
  source: SliceGeometry,
  targets: SliceGeometry[]
): number | null => {
  const plane = comparisonPlane(source);
  if (!plane || !targets.length) return null;
  const positions: number[] = [];
  for (const target of targets) {
    const candidate = comparisonPlane(target);
    // Approximately 0.8 degrees: do not silently synchronize oblique or localizer planes.
    if (
      !candidate ||
      target.frame !== source.frame ||
      Math.abs(dot(plane.normal, candidate.normal)) < 0.9999
    )
      return null;
    // The source center must be covered in-plane by the target, not merely share its Z coordinate.
    const center = source.position.map(
      (value, axis) =>
        value +
        (plane.row[axis] * source.spacing[1] * (source.columns - 1)) / 2 +
        (plane.column[axis] * source.spacing[0] * (source.rows - 1)) / 2
    );
    const delta = center.map((value, axis) => value - target.position[axis]);
    const x = dot(delta, candidate.row) / target.spacing[1];
    const y = dot(delta, candidate.column) / target.spacing[0];
    if (x < -0.5 || y < -0.5 || x > target.columns - 0.5 || y > target.rows - 0.5) return null;
    positions.push(dot(target.position, plane.normal));
  }
  const location = dot(source.position, plane.normal);
  // Never clamp a view outside the other series' physical coverage to an end slice.
  if (location < Math.min(...positions) - 0.001 || location > Math.max(...positions) + 0.001)
    return null;
  return positions.reduce(
    (best, position, index) =>
      Math.abs(position - location) < Math.abs(positions[best] - location) ? index : best,
    0
  );
};

/** Intersect a plane with the target image rectangle. Result is in patient-space mm. */
export const comparisonReferenceLine = (
  source: SliceGeometry,
  target: SliceGeometry
): number[][] | null => {
  const a = comparisonPlane(source),
    b = comparisonPlane(target);
  if (!a || !b || source.frame !== target.frame || Math.abs(dot(a.normal, b.normal)) > 0.9999)
    return null;
  const corners = [
    [0, 0],
    [target.columns - 1, 0],
    [target.columns - 1, target.rows - 1],
    [0, target.rows - 1],
  ].map(([x, y]) =>
    target.position.map(
      (value, axis) =>
        value + b.row[axis] * x * target.spacing[1] + b.column[axis] * y * target.spacing[0]
    )
  );
  const offset = dot(source.position, a.normal);
  const intersections: number[][] = [];
  for (let index = 0; index < 4; index++) {
    const start = corners[index],
      end = corners[(index + 1) % 4];
    const d1 = dot(start, a.normal) - offset,
      d2 = dot(end, a.normal) - offset;
    if (Math.abs(d1 - d2) < 1e-8 || d1 * d2 > 0) continue;
    const t = d1 / (d1 - d2);
    const point = start.map((value, axis) => value + t * (end[axis] - value));
    if (
      !intersections.some(previous =>
        previous.every((value, axis) => Math.abs(value - point[axis]) < 1e-6)
      )
    )
      intersections.push(point);
  }
  return intersections.length === 2 ? intersections : null;
};
