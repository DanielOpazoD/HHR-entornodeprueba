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
const dot = (v: number[], w: number[]) => v.reduce((sum, x, i) => sum + x * w[i], 0);

/** DICOM C.7.6.2: positions are pixel centers, PixelSpacing is row then column.
 * Compare all four physical pixel-edge bounds; never crop, pad a missing FOV,
 * drop a slice, or stretch its array to make heterogeneous matrices fit.
 */
export const planDicomVolume = (slices: SliceGeometry[]): DicomVolumePlan => {
  if (slices.length < 3)
    throw new Error('MPR y 3D requieren al menos tres cortes con geometría compatible.');
  const first = slices[0];
  const finiteVector = (v: number[], length: number) =>
    v.length === length && v.every(Number.isFinite);
  if (
    !finiteVector(first.orientation, 6) ||
    !finiteVector(first.position, 3) ||
    !finiteVector(first.spacing, 2) ||
    first.spacing.some(value => value <= 0) ||
    !first.frame
  )
    throw new Error('La serie no tiene geometría suficiente para reconstruir el volumen.');
  const [a, b, c, d, e, f] = first.orientation;
  let normal = [b * f - c * e, c * d - a * f, a * e - b * d];
  if (
    Math.abs(dot(normal, normal) - 1) > 0.001 ||
    Math.abs(a * a + b * b + c * c - 1) > 0.001 ||
    Math.abs(d * d + e * e + f * f - 1) > 0.001 ||
    Math.abs(a * d + b * e + c * f) > 0.001
  )
    throw new Error('La orientación de los cortes no es válida para MPR.');
  // Normalize decimal-string rounding within the validated orientation tolerance.
  const unit = (v: number[]) => v.map(value => value / Math.sqrt(dot(v, v)));
  const row = unit([a, b, c]);
  const second = [d, e, f];
  const column = unit(second.map((value, i) => value - dot(second, row) * row[i]));
  normal = [
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ];
  const resampled = slices.some(
    slice =>
      slice.rows !== first.rows ||
      slice.columns !== first.columns ||
      slice.spacing.some((value, i) => value !== first.spacing[i])
  );
  const bounds = (slice: SliceGeometry) => {
    const x = dot(slice.position, row) - slice.spacing[1] / 2;
    const y = dot(slice.position, column) - slice.spacing[0] / 2;
    return [x, y, x + slice.columns * slice.spacing[1], y + slice.rows * slice.spacing[0]];
  };
  const firstBounds = bounds(first);
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
      if (!finiteVector(slice.position, 3))
        throw new Error(
          'La serie tiene posiciones de corte incompletas o no válidas; utiliza la vista original.'
        );
      if (
        !finiteVector(slice.orientation, 6) ||
        slice.orientation.some((value, i) => Math.abs(value - first.orientation[i]) > 0.0001)
      )
        throw new Error(
          'La serie contiene orientaciones de corte diferentes o no válidas; utiliza la vista original.'
        );
      if (!finiteVector(slice.spacing, 2) || slice.spacing.some(value => value <= 0))
        throw new Error(
          'La serie contiene distintos tamaños de píxel o valores no válidos; utiliza la vista original.'
        );
      const delta = slice.position.map((value, i) => value - first.position[i]);
      const distance = dot(delta, normal);
      const drift = delta.map((value, i) => value - distance * normal[i]);
      if (resampled) {
        const extent = Math.max(slice.rows * slice.spacing[0], slice.columns * slice.spacing[1]);
        if (
          slice.orientation.some(
            (value, i) => Math.abs(value - first.orientation[i]) * extent > edgeTolerance
          )
        )
          throw new Error(
            'Las orientaciones difieren en los bordes del campo; utiliza la vista original.'
          );
        if (
          bounds(slice).some(
            (value, i) =>
              !Number.isFinite(value) || Math.abs(value - firstBounds[i]) > edgeTolerance
          )
        )
          throw new Error(
            'Las matrices cubren campos físicos diferentes; utiliza la vista original.'
          );
      } else if (Math.sqrt(dot(drift, drift)) > 0.1)
        throw new Error('La serie tiene inclinación de adquisición; utiliza la vista original.');
      return { slice, distance };
    })
    .sort((x, y) => x.distance - y.distance);
  const spacing =
    (ordered[ordered.length - 1].distance - ordered[0].distance) / (ordered.length - 1);
  if (
    spacing < 0.01 ||
    ordered
      .slice(1)
      .some(
        (item, i) =>
          item.distance - ordered[i].distance < 0.01 ||
          Math.abs(item.distance - ordered[i].distance - spacing) > Math.min(0.05, spacing * 0.02)
      )
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
  const base = ordered[0].slice;
  const origin = base.position.map(
    (value, i) =>
      value +
      (row[i] * (columnSpacing - base.spacing[1])) / 2 +
      (column[i] * (rowSpacing - base.spacing[0])) / 2
  ) as [number, number, number];
  return {
    slices: ordered.map(item => item.slice),
    dimensions: [columns, rows, slices.length],
    spacing: [columnSpacing, rowSpacing, spacing],
    origin,
    direction: [...row, ...column, ...normal],
    resampled,
  };
};

export const volumeImageOrder = (slices: SliceGeometry[]): string[] =>
  planDicomVolume(slices).slices.map(slice => slice.imageId);
