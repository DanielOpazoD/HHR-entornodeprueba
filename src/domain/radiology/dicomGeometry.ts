export interface SliceGeometry {
  imageId: string;
  position: number[];
  orientation: number[];
  spacing: number[];
  frame: string;
  rows: number;
  columns: number;
}

/** Reject duplicates, missing slices, mixed frames and gantry tilt rather than invent geometry. */
export const volumeImageOrder = (slices: SliceGeometry[]): string[] => {
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
  const normal = [b * f - c * e, c * d - a * f, a * e - b * d];
  const dot = (v: number[], w: number[]) => v.reduce((sum, x, i) => sum + x * w[i], 0);
  if (
    Math.abs(dot(normal, normal) - 1) > 0.001 ||
    Math.abs(a * a + b * b + c * c - 1) > 0.001 ||
    Math.abs(d * d + e * e + f * f - 1) > 0.001 ||
    Math.abs(a * d + b * e + c * f) > 0.001
  )
    throw new Error('La orientación de los cortes no es válida para MPR.');
  const ordered = slices
    .map(slice => {
      if (
        slice.frame !== first.frame ||
        slice.rows !== first.rows ||
        slice.columns !== first.columns ||
        !finiteVector(slice.position, 3) ||
        !finiteVector(slice.orientation, 6) ||
        !finiteVector(slice.spacing, 2) ||
        slice.orientation.some((value, i) => Math.abs(value - first.orientation[i]) > 0.0001) ||
        slice.spacing.some((value, i) => Math.abs(value - first.spacing[i]) > 0.0001)
      )
        throw new Error('La serie mezcla geometrías; utiliza la vista original.');
      const delta = slice.position.map((value, i) => value - first.position[i]);
      const distance = dot(delta, normal);
      const drift = delta.map((value, i) => value - distance * normal[i]);
      if (Math.sqrt(dot(drift, drift)) > 0.1)
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
          Math.abs(item.distance - ordered[i].distance - spacing) > Math.max(0.05, spacing * 0.02)
      )
  )
    throw new Error('Los cortes están repetidos, incompletos o no tienen un espaciado uniforme.');
  return ordered.map(item => item.slice.imageId);
};
