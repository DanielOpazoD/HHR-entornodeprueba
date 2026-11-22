import { MAX_RESAMPLED_BYTES, type DicomVolumePlan, type SliceGeometry } from './dicomGeometry';

export interface DicomScalarPlane {
  pixels: ArrayLike<number>;
  slope: number;
  intercept: number;
  preScaled: boolean;
}

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

const invalidPixels = () =>
  new Error(
    'Los píxeles o su escala no son compatibles con el remuestreo; utiliza la vista original.'
  );

const readVec2 = (values: readonly number[]): Vec2 | null => {
  const x = values[0];
  const y = values[1];
  return x !== undefined && y !== undefined ? [x, y] : null;
};

const readVec3 = (values: readonly number[], offset = 0): Vec3 | null => {
  const x = values[offset];
  const y = values[offset + 1];
  const z = values[offset + 2];
  return x !== undefined && y !== undefined && z !== undefined ? [x, y, z] : null;
};

const dot3 = (v: Vec3, w: Vec3): number => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];

const unit3 = (v: Vec3): Vec3 => {
  const norm = Math.sqrt(dot3(v, v));
  return [v[0] / norm, v[1] / norm, v[2] / norm];
};

/** Bilinear interpolation in patient space, in calibrated units. No z interpolation.
 * Boundary replication is limited to the acquired half-pixel footprint, never a missing FOV.
 * The destination uses the finest sampling on each axis, so no source plane is downsampled.
 */
export const resampleDicomVolume = async (
  plan: DicomVolumePlan,
  read: (slice: SliceGeometry, index: number) => DicomScalarPlane,
  signal: AbortSignal
): Promise<Float32Array> => {
  signal.throwIfAborted();
  const [width, height, depth] = plan.dimensions;
  const length = width * height * depth;
  if (!Number.isSafeInteger(length) || length <= 0 || length * 4 > MAX_RESAMPLED_BYTES)
    throw new Error(
      'El volumen remuestreado supera el límite de memoria; utiliza la vista original.'
    );
  const row = readVec3(plan.direction, 0);
  const column = readVec3(plan.direction, 3);
  const normal = readVec3(plan.direction, 6);
  if (!row || !column || !normal) throw invalidPixels();

  const output = new Float32Array(length);
  for (let z = 0; z < depth; z++) {
    signal.throwIfAborted();
    const slice = plan.slices[z];
    if (!slice) throw invalidPixels();
    const source = read(slice, z);
    if (
      source.pixels.length !== slice.rows * slice.columns ||
      !Number.isFinite(source.slope) ||
      source.slope === 0 ||
      !Number.isFinite(source.intercept)
    )
      throw invalidPixels();
    const slope = source.preScaled ? 1 : source.slope;
    const intercept = source.preScaled ? 0 : source.intercept;

    const rawSourceRow = readVec3(slice.orientation, 0);
    const second = readVec3(slice.orientation, 3);
    const slicePosition = readVec3(slice.position, 0);
    const sliceSpacing = readVec2(slice.spacing);
    if (!rawSourceRow || !second || !slicePosition || !sliceSpacing) throw invalidPixels();

    // Project onto this source's own normalized axes, not the reference slice's axes.
    const sourceRow = unit3(rawSourceRow);
    const proj = dot3(second, sourceRow);
    const sourceColumn = unit3([
      second[0] - proj * sourceRow[0],
      second[1] - proj * sourceRow[1],
      second[2] - proj * sourceRow[2],
    ]);

    const distance = dot3(
      [
        slicePosition[0] - plan.origin[0],
        slicePosition[1] - plan.origin[1],
        slicePosition[2] - plan.origin[2],
      ],
      normal
    );
    const delta: Vec3 = [
      plan.origin[0] + distance * normal[0] - slicePosition[0],
      plan.origin[1] + distance * normal[1] - slicePosition[1],
      plan.origin[2] + distance * normal[2] - slicePosition[2],
    ];
    const startX = dot3(delta, sourceRow) / sliceSpacing[1];
    const startY = dot3(delta, sourceColumn) / sliceSpacing[0];
    const xx = (dot3(row, sourceRow) * plan.spacing[0]) / sliceSpacing[1];
    const xy = (dot3(column, sourceRow) * plan.spacing[1]) / sliceSpacing[1];
    const yx = (dot3(row, sourceColumn) * plan.spacing[0]) / sliceSpacing[0];
    const yy = (dot3(column, sourceColumn) * plan.spacing[1]) / sliceSpacing[0];
    // The affine map reaches its extrema at corners. Reject missing coverage before clamping.
    for (const x of [0, width - 1])
      for (const y of [0, height - 1]) {
        const sx = startX + x * xx + y * xy,
          sy = startY + x * yx + y * yy;
        if (
          !Number.isFinite(sx) ||
          !Number.isFinite(sy) ||
          sx < -0.5 ||
          sx > slice.columns - 0.5 ||
          sy < -0.5 ||
          sy > slice.rows - 0.5
        )
          throw new Error('El remuestreo excede el campo adquirido; utiliza la vista original.');
      }
    const rowsPerChunk = Math.max(1, Math.floor(65536 / width));
    for (let y = 0; y < height; y++) {
      if (y % rowsPerChunk === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal.throwIfAborted();
      }
      for (let x = 0; x < width; x++) {
        const sy = Math.max(0, Math.min(slice.rows - 1, startY + x * yx + y * yy));
        const y0 = Math.floor(sy),
          y1 = Math.min(y0 + 1, slice.rows - 1),
          fy = sy - y0;
        const sx = Math.max(0, Math.min(slice.columns - 1, startX + x * xx + y * xy));
        const x0 = Math.floor(sx),
          x1 = Math.min(x0 + 1, slice.columns - 1),
          fx = sx - x0;
        const a = source.pixels[y0 * slice.columns + x0];
        const b = source.pixels[y0 * slice.columns + x1];
        const c = source.pixels[y1 * slice.columns + x0];
        const d = source.pixels[y1 * slice.columns + x1];
        if (a === undefined || b === undefined || c === undefined || d === undefined)
          throw invalidPixels();
        const value =
          ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * slope + intercept;
        const index = (z * height + y) * width + x;
        output[index] = value;
        const written = output[index];
        if (written === undefined || !Number.isFinite(written)) throw invalidPixels();
      }
    }
  }
  signal.throwIfAborted();
  return output;
};
