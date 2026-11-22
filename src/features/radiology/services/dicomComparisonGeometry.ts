import type { SliceGeometry } from '@/features/radiology/domain/dicomGeometry';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Orientation6 = readonly [number, number, number, number, number, number];

export const dot = (a: readonly number[], b: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av !== undefined && bv !== undefined) {
      sum += av * bv;
    }
  }
  return sum;
};

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const isFiniteVec2 = (values: readonly number[]): values is Vec2 =>
  values.length === 2 && Number.isFinite(values[0]) && Number.isFinite(values[1]);

const isFiniteVec3 = (values: readonly number[]): values is Vec3 =>
  values.length === 3 &&
  Number.isFinite(values[0]) &&
  Number.isFinite(values[1]) &&
  Number.isFinite(values[2]);

const isFiniteOrientation6 = (values: readonly number[]): values is Orientation6 =>
  values.length === 6 && values.every(Number.isFinite);

interface ComparisonPlane {
  row: Vec3;
  column: Vec3;
  normal: Vec3;
  position: Vec3;
  spacing: Vec2;
}

/** Only original, verified patient-space geometry; no registration or index-based fallback. */
export const comparisonPlane = (slice: SliceGeometry): ComparisonPlane | null => {
  if (
    !slice.frame ||
    !isFiniteVec3(slice.position) ||
    !isFiniteOrientation6(slice.orientation) ||
    !isFiniteVec2(slice.spacing) ||
    slice.spacing[0] <= 0 ||
    slice.spacing[1] <= 0 ||
    ![slice.rows, slice.columns].every(value => Number.isSafeInteger(value) && value > 0)
  )
    return null;
  const [r0, r1, r2, c0, c1, c2] = slice.orientation;
  const row: Vec3 = [r0, r1, r2];
  const column: Vec3 = [c0, c1, c2];
  if (
    Math.abs(dot3(row, row) - 1) > 0.001 ||
    Math.abs(dot3(column, column) - 1) > 0.001 ||
    Math.abs(dot3(row, column)) > 0.001
  )
    return null;
  const rawNormal = cross3(row, column);
  const length = Math.sqrt(dot3(rawNormal, rawNormal));
  const normal: Vec3 = [rawNormal[0] / length, rawNormal[1] / length, rawNormal[2] / length];
  return { row, column, normal, position: slice.position, spacing: slice.spacing };
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
      Math.abs(dot3(plane.normal, candidate.normal)) < 0.9999
    )
      return null;
    // The source center must be covered in-plane by the target, not merely share its Z coordinate.
    const center: Vec3 = [
      plane.position[0] +
        (plane.row[0] * plane.spacing[1] * (source.columns - 1)) / 2 +
        (plane.column[0] * plane.spacing[0] * (source.rows - 1)) / 2,
      plane.position[1] +
        (plane.row[1] * plane.spacing[1] * (source.columns - 1)) / 2 +
        (plane.column[1] * plane.spacing[0] * (source.rows - 1)) / 2,
      plane.position[2] +
        (plane.row[2] * plane.spacing[1] * (source.columns - 1)) / 2 +
        (plane.column[2] * plane.spacing[0] * (source.rows - 1)) / 2,
    ];
    const delta: Vec3 = [
      center[0] - candidate.position[0],
      center[1] - candidate.position[1],
      center[2] - candidate.position[2],
    ];
    const x = dot3(delta, candidate.row) / candidate.spacing[1];
    const y = dot3(delta, candidate.column) / candidate.spacing[0];
    if (x < -0.5 || y < -0.5 || x > target.columns - 0.5 || y > target.rows - 0.5) return null;
    positions.push(dot3(candidate.position, plane.normal));
  }
  const location = dot3(plane.position, plane.normal);
  // Never clamp a view outside the other series' physical coverage to an end slice.
  if (location < Math.min(...positions) - 0.001 || location > Math.max(...positions) + 0.001)
    return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  positions.forEach((position, index) => {
    const distance = Math.abs(position - location);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
};

/** Intersect a plane with the target image rectangle. Result is in patient-space mm. */
export const comparisonReferenceLine = (
  source: SliceGeometry,
  target: SliceGeometry
): number[][] | null => {
  const a = comparisonPlane(source),
    b = comparisonPlane(target);
  if (!a || !b || source.frame !== target.frame || Math.abs(dot3(a.normal, b.normal)) > 0.9999)
    return null;
  const cornerCoords: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [target.columns - 1, 0],
    [target.columns - 1, target.rows - 1],
    [0, target.rows - 1],
  ];
  const corners: Vec3[] = cornerCoords.map(([x, y]) => [
    b.position[0] + b.row[0] * x * b.spacing[1] + b.column[0] * y * b.spacing[0],
    b.position[1] + b.row[1] * x * b.spacing[1] + b.column[1] * y * b.spacing[0],
    b.position[2] + b.row[2] * x * b.spacing[1] + b.column[2] * y * b.spacing[0],
  ]);
  const offset = dot3(a.position, a.normal);
  const intersections: Vec3[] = [];
  for (let index = 0; index < corners.length; index++) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    if (!start || !end) continue;
    const d1 = dot3(start, a.normal) - offset,
      d2 = dot3(end, a.normal) - offset;
    if (Math.abs(d1 - d2) < 1e-8 || d1 * d2 > 0) continue;
    const t = d1 / (d1 - d2);
    const point: Vec3 = [
      start[0] + t * (end[0] - start[0]),
      start[1] + t * (end[1] - start[1]),
      start[2] + t * (end[2] - start[2]),
    ];
    if (
      !intersections.some(
        previous =>
          Math.abs(previous[0] - point[0]) < 1e-6 &&
          Math.abs(previous[1] - point[1]) < 1e-6 &&
          Math.abs(previous[2] - point[2]) < 1e-6
      )
    )
      intersections.push(point);
  }
  return intersections.length === 2 ? intersections.map(point => [...point]) : null;
};
