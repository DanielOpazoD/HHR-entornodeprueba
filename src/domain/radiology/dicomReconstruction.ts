import type { DicomVolumePlan } from './dicomGeometry';

export type SlabMode = 'average' | 'mip' | 'minip';
export interface MprSettings {
  rotate: boolean;
  thickness: number;
  mode: SlabMode;
}
export const defaultMprSettings = (): MprSettings => ({
  rotate: false,
  thickness: 0,
  mode: 'average',
});
export const slabLabels: Record<SlabMode, string> = {
  average: 'Promedio',
  mip: 'MIP',
  minip: 'MinIP',
};
export const validateMprSettings = (value: MprSettings): MprSettings => {
  if (
    !Number.isFinite(value.thickness) ||
    value.thickness < 0 ||
    (value.thickness > 0 && value.thickness < 0.5) ||
    value.thickness > 50 ||
    !Object.hasOwn(slabLabels, value.mode) ||
    typeof value.rotate !== 'boolean'
  )
    throw new Error('Espesor no válido: utiliza entre 0 y 50 mm.');
  return { ...value };
};
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
export const isObliqueNormal = (normal: number[]) =>
  !normal.some(value => Math.abs(Math.abs(value) - 1) < 1e-5);

/** Physical ray/box intersection at the reference point, in the validated voxel basis.
 * Reports truncation, never invents samples beyond the acquired pixel-edge bounds.
 */
export const slabCoverage = (
  plan: DicomVolumePlan,
  point: number[],
  normal: number[],
  thickness: number
) => {
  let near = -Infinity,
    far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const direction = plan.direction.slice(axis * 3, axis * 3 + 3);
    const origin = dot(
      point.map((x, i) => x - plan.origin[i]),
      direction
    );
    const velocity = dot(normal, direction);
    const lower = -plan.spacing[axis] / 2;
    const upper = (plan.dimensions[axis] - 0.5) * plan.spacing[axis];
    if (Math.abs(velocity) < 1e-8) {
      if (origin < lower || origin > upper) return 0;
      continue;
    }
    const a = (lower - origin) / velocity,
      b = (upper - origin) / velocity;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return Math.max(0, Math.min(thickness / 2, far) - Math.max(-thickness / 2, near));
};
