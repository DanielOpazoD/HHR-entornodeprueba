export interface SliceGeometry {
  imageId: string;
  position: number[];
  orientation: number[];
  spacing: number[];
  frame: string;
  rows: number;
  columns: number;
}

export interface DicomVolumePlan {
  slices: SliceGeometry[];
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  direction: number[];
  resampled: boolean;
}

export const MAX_RESAMPLED_BYTES = 256 * 1024 * 1024;

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Bounds4 = readonly [number, number, number, number];
type Orientation6 = readonly [number, number, number, number, number, number];

const ORIENTATION_INDICES = [0, 1, 2, 3, 4, 5] as const;
const BOUNDS_INDICES = [0, 1, 2, 3] as const;

const isFiniteVec2 = (v: readonly number[]): v is Vec2 =>
  v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);

const isFiniteVec3 = (v: readonly number[]): v is Vec3 =>
  v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

const isFiniteOrientation6 = (v: readonly number[]): v is Orientation6 =>
  v.length === 6 && v.every(Number.isFinite);

const dot3 = (v: Vec3, w: Vec3): number => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];

const unit3 = (v: Vec3): Vec3 => {
  const norm = Math.sqrt(dot3(v, v));
  return [v[0] / norm, v[1] / norm, v[2] / norm];
};

/** DICOM C.7.6.2: positions are pixel centers, PixelSpacing is row then column.
 * Compare all four physical pixel-edge bounds; never crop, pad a missing FOV,
 * drop a slice, or stretch its array to make heterogeneous matrices fit.
 */
export const planDicomVolume = (slices: SliceGeometry[]): DicomVolumePlan => {
  const first = slices[0];
  if (slices.length < 3 || !first)
    throw new Error('MPR y 3D requieren al menos tres cortes con geometría compatible.');
  if (
    !isFiniteOrientation6(first.orientation) ||
    !isFiniteVec3(first.position) ||
    !isFiniteVec2(first.spacing) ||
    first.spacing[0] <= 0 ||
    first.spacing[1] <= 0 ||
    !first.frame
  )
    throw new Error('La serie no tiene geometría suficiente para reconstruir el volumen.');

  const firstOrientation: Orientation6 = first.orientation;
  const firstPosition: Vec3 = first.position;
  const firstSpacing: Vec2 = first.spacing;

  const [a, b, c, d, e, f] = firstOrientation;
  let normal: Vec3 = [b * f - c * e, c * d - a * f, a * e - b * d];
  if (
    Math.abs(dot3(normal, normal) - 1) > 0.001 ||
    Math.abs(a * a + b * b + c * c - 1) > 0.001 ||
    Math.abs(d * d + e * e + f * f - 1) > 0.001 ||
    Math.abs(a * d + b * e + c * f) > 0.001
  )
    throw new Error('La orientación de los cortes no es válida para MPR.');

  // Normalize decimal-string rounding within the validated orientation tolerance.
  const row = unit3([a, b, c]);
  const second: Vec3 = [d, e, f];
  const proj = dot3(second, row);
  const column = unit3([
    second[0] - proj * row[0],
    second[1] - proj * row[1],
    second[2] - proj * row[2],
  ]);
  normal = [
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ];

  const resampled = slices.some(
    slice =>
      slice.rows !== first.rows ||
      slice.columns !== first.columns ||
      slice.spacing.length !== 2 ||
      slice.spacing[0] !== firstSpacing[0] ||
      slice.spacing[1] !== firstSpacing[1]
  );

  const bounds = (position: Vec3, spacing: Vec2, rows: number, columns: number): Bounds4 => {
    const x = dot3(position, row) - spacing[1] / 2;
    const y = dot3(position, column) - spacing[0] / 2;
    return [x, y, x + columns * spacing[1], y + rows * spacing[0]];
  };

  const firstBounds = bounds(firstPosition, firstSpacing, first.rows, first.columns);
  // A sub-pixel rounding allowance, never a fixed tolerance wider than a pixel.
  const edgeTolerance = Math.min(
    0.001,
    ...slices.flatMap(slice => slice.spacing.map(value => value * 0.001))
  );

  const ordered = slices
    .map(slice => {
      if (slice.frame !== first.frame)
        throw new Error(
          'La serie contiene distintos marcos de referencia; utiliza la vista original.'
        );
      if (![slice.rows, slice.columns].every(value => Number.isSafeInteger(value) && value > 0))
        throw new Error(
          'La serie contiene dimensiones de imagen no válidas; utiliza la vista original.'
        );
      if (!isFiniteVec3(slice.position))
        throw new Error(
          'La serie tiene posiciones de corte incompletas o no válidas; utiliza la vista original.'
        );
      if (!isFiniteOrientation6(slice.orientation))
        throw new Error(
          'La serie contiene orientaciones de corte diferentes o no válidas; utiliza la vista original.'
        );
      const sliceOrientation: Orientation6 = slice.orientation;
      if (
        ORIENTATION_INDICES.some(i => Math.abs(sliceOrientation[i] - firstOrientation[i]) > 0.0001)
      )
        throw new Error(
          'La serie contiene orientaciones de corte diferentes o no válidas; utiliza la vista original.'
        );
      if (!isFiniteVec2(slice.spacing) || slice.spacing[0] <= 0 || slice.spacing[1] <= 0)
        throw new Error(
          'La serie contiene distintos tamaños de píxel o valores no válidos; utiliza la vista original.'
        );

      const slicePosition: Vec3 = slice.position;
      const sliceSpacing: Vec2 = slice.spacing;

      const delta: Vec3 = [
        slicePosition[0] - firstPosition[0],
        slicePosition[1] - firstPosition[1],
        slicePosition[2] - firstPosition[2],
      ];
      const distance = dot3(delta, normal);
      const drift: Vec3 = [
        delta[0] - distance * normal[0],
        delta[1] - distance * normal[1],
        delta[2] - distance * normal[2],
      ];

      if (resampled) {
        const extent = Math.max(slice.rows * sliceSpacing[0], slice.columns * sliceSpacing[1]);
        if (
          ORIENTATION_INDICES.some(
            i => Math.abs(sliceOrientation[i] - firstOrientation[i]) * extent > edgeTolerance
          )
        )
          throw new Error(
            'Las orientaciones difieren en los bordes del campo; utiliza la vista original.'
          );
        const sliceBounds = bounds(slicePosition, sliceSpacing, slice.rows, slice.columns);
        if (
          BOUNDS_INDICES.some(
            i =>
              !Number.isFinite(sliceBounds[i]) ||
              Math.abs(sliceBounds[i] - firstBounds[i]) > edgeTolerance
          )
        )
          throw new Error(
            'Las matrices cubren campos físicos diferentes; utiliza la vista original.'
          );
      } else if (Math.sqrt(dot3(drift, drift)) > 0.1)
        throw new Error('La serie tiene inclinación de adquisición; utiliza la vista original.');

      return { slice, position: slicePosition, spacing: sliceSpacing, distance };
    })
    .sort((x, y) => x.distance - y.distance);

  const firstOrdered = ordered[0];
  const lastOrdered = ordered[ordered.length - 1];
  if (!firstOrdered || !lastOrdered)
    throw new Error('Los cortes están repetidos, incompletos o no tienen un espaciado uniforme.');

  const spacing = (lastOrdered.distance - firstOrdered.distance) / (ordered.length - 1);
  if (
    spacing < 0.01 ||
    ordered.slice(1).some((item, i) => {
      const previous = ordered[i];
      if (!previous) return true;
      const gap = item.distance - previous.distance;
      return gap < 0.01 || Math.abs(gap - spacing) > Math.min(0.05, spacing * 0.02);
    })
  )
    throw new Error('Los cortes están repetidos, incompletos o no tienen un espaciado uniforme.');

  const columns = Math.max(...slices.map(slice => slice.columns));
  const rows = Math.max(...slices.map(slice => slice.rows));
  if (
    resampled &&
    (columns > 4096 || rows > 4096 || columns * rows * slices.length * 4 > MAX_RESAMPLED_BYTES)
  )
    throw new Error(
      'El volumen remuestreado supera el límite de memoria; utiliza la vista original.'
    );

  const columnSpacing = (firstBounds[2] - firstBounds[0]) / columns;
  const rowSpacing = (firstBounds[3] - firstBounds[1]) / rows;
  const basePosition = firstOrdered.position;
  const baseSpacing = firstOrdered.spacing;
  const origin: [number, number, number] = [
    basePosition[0] +
      (row[0] * (columnSpacing - baseSpacing[1])) / 2 +
      (column[0] * (rowSpacing - baseSpacing[0])) / 2,
    basePosition[1] +
      (row[1] * (columnSpacing - baseSpacing[1])) / 2 +
      (column[1] * (rowSpacing - baseSpacing[0])) / 2,
    basePosition[2] +
      (row[2] * (columnSpacing - baseSpacing[1])) / 2 +
      (column[2] * (rowSpacing - baseSpacing[0])) / 2,
  ];

  return {
    slices: ordered.map(item => item.slice),
    dimensions: [columns, rows, slices.length],
    spacing: [columnSpacing, rowSpacing, spacing],
    origin,
    direction: [...row, ...column, ...normal],
    resampled,
  };
};
