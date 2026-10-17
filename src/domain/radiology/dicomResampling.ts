import { MAX_RESAMPLED_BYTES, type DicomVolumePlan, type SliceGeometry } from './dicomGeometry';

export interface DicomScalarPlane {
  pixels: ArrayLike<number>;
  slope: number;
  intercept: number;
  preScaled: boolean;
}
const invalidPixels = () =>
  new Error(
    'Los píxeles o su escala no son compatibles con el remuestreo; utiliza la vista original.'
  );

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
  const output = new Float32Array(length);
  const row = plan.direction.slice(0, 3);
  const column = plan.direction.slice(3, 6);
  const dot = (v: number[], w: number[]) => v.reduce((sum, x, i) => sum + x * w[i], 0);
  for (let z = 0; z < depth; z++) {
    signal.throwIfAborted();
    const slice = plan.slices[z];
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
    // Project onto this source's own normalized axes, not the reference slice's axes.
    const unit = (v: number[]) => v.map(value => value / Math.sqrt(dot(v, v)));
    const sourceRow = unit(slice.orientation.slice(0, 3));
    const second = slice.orientation.slice(3, 6);
    const sourceColumn = unit(
      second.map((value, i) => value - dot(second, sourceRow) * sourceRow[i])
    );
    const normal = plan.direction.slice(6, 9);
    const distance = dot(
      slice.position.map((value, i) => value - plan.origin[i]),
      normal
    );
    const delta = plan.origin.map((value, i) => value + distance * normal[i] - slice.position[i]);
    const startX = dot(delta, sourceRow) / slice.spacing[1];
    const startY = dot(delta, sourceColumn) / slice.spacing[0];
    const xx = (dot(row, sourceRow) * plan.spacing[0]) / slice.spacing[1];
    const xy = (dot(column, sourceRow) * plan.spacing[1]) / slice.spacing[1];
    const yx = (dot(row, sourceColumn) * plan.spacing[0]) / slice.spacing[0];
    const yy = (dot(column, sourceColumn) * plan.spacing[1]) / slice.spacing[0];
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
        const value =
          ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * slope + intercept;
        const index = (z * height + y) * width + x;
        output[index] = value;
        if (!Number.isFinite(output[index])) throw invalidPixels();
      }
    }
  }
  signal.throwIfAborted();
  return output;
};
