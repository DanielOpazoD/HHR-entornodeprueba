export const volumeLooks = {
  CT: [
    ['CT-Bone', 'Hueso'],
    ['CT-Soft-Tissue', 'Tejidos blandos'],
    ['CT-Muscle', 'Músculo'],
    ['CT-Fat', 'Grasa'],
    ['CT-Lung', 'Pulmón'],
  ],
  MR: [
    ['MR-Default', 'RM general'],
    ['MR-T2-Brain', 'RM T2'],
  ],
} as const;
export interface VolumePresentation {
  preset: string;
  opacity: number;
  shift: number;
  shading: boolean;
  clipAxis: 'none' | 'x' | 'y' | 'z';
  clipPercent: number;
  clipReverse: boolean;
}
export const defaultVolumePresentation = (modality: string): VolumePresentation => ({
  preset: modality === 'MR' ? 'MR-Default' : 'CT-Bone',
  opacity: 100,
  shift: 0,
  shading: true,
  clipAxis: 'none',
  clipPercent: 0,
  clipReverse: false,
});
export const normalizeVolumePresentation = (
  value: VolumePresentation,
  modality: string
): VolumePresentation => {
  const options = modality === 'MR' ? volumeLooks.MR : volumeLooks.CT;
  const finite = (n: number, fallback: number, min: number, max: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  return {
    preset: options.some(([id]) => id === value.preset) ? value.preset : options[0][0],
    opacity: finite(value.opacity, 100, 5, 100),
    shift: modality === 'CT' ? finite(value.shift, 0, -1000, 1000) : 0,
    shading: value.shading === true,
    clipAxis: ['x', 'y', 'z'].includes(value.clipAxis) ? value.clipAxis : 'none',
    clipPercent: finite(value.clipPercent, 0, 0, 95),
    clipReverse: value.clipReverse === true,
  };
};
/** Change rendering transfer functions only; source voxels stay untouched. */
export const adjustTransfer = (encoded: string, stride: 2 | 4, shift: number, opacity = 1) => {
  const values = encoded.split(' ').map(Number);
  for (let i = 1; i < values.length; i += stride) {
    values[i] += shift;
    if (stride === 2) values[i + 1] *= opacity;
  }
  return values.join(' ');
};
