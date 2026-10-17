import type { DataSet } from 'dicom-parser';
import type { Types } from '@cornerstonejs/core';
import { supportsDicomResampling } from './dicomPixelMapping';
import { isDicomCtLocalizer } from './dicomLocalizer';

/** PS3.3 C.8.2: never infer HU from modality alone or silently default missing scaling. */
export const hasDicomHuCalibration = (data: DataSet, image: Types.IImage): boolean => {
  const number = (tag: string) => {
    const value = data.string(tag)?.trim();
    return value ? Number(value) : NaN;
  };
  const slope = number('x00281053');
  const intercept = number('x00281052');
  const spacing = data.string('x00280030')?.split('\\').map(Number) ?? [];
  const unit = data.string('x00281054')?.trim();
  const imageType = data.string('x00080008')?.split('\\');
  const conventionalHu =
    imageType?.[0] === 'ORIGINAL' &&
    Boolean(imageType[2]) &&
    imageType[2] !== 'LOCALIZER' &&
    (!data.string('x00189361') || data.string('x00189361') === 'NO');
  const scale = image.preScale?.scalingParameters;
  return (
    data.string('x00080016') === '1.2.840.10008.5.1.4.1.1.2' &&
    data.string('x00080060') === 'CT' &&
    !isDicomCtLocalizer(data) &&
    supportsDicomResampling(data) &&
    (unit === 'HU' || (!unit && conventionalHu)) &&
    data.string('x00280004') === 'MONOCHROME2' &&
    data.uint16('x00280002') === 1 &&
    spacing.length === 2 &&
    spacing.every(value => Number.isFinite(value) && value > 0) &&
    Number.isFinite(slope) &&
    slope !== 0 &&
    Number.isFinite(intercept) &&
    !image.color &&
    !image.modalityLUT &&
    image.preScale?.scaled === true &&
    scale?.rescaleSlope === slope &&
    scale?.rescaleIntercept === intercept
  );
};

type Statistics = {
  value?: number;
  area?: number;
  mean?: number;
  stdDev?: number;
  areaUnit?: string;
  modalityUnit?: string;
  isEmptyArea?: boolean;
};
type Data = { cachedStats: Record<string, Statistics> };
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const huProbeText = (data: Data, target: string): string[] => {
  const stats = data.cachedStats[target];
  return stats?.modalityUnit === 'HU' && finite(stats.value)
    ? [`${stats.value.toFixed(1)} HU`]
    : ['HU no disponible'];
};
export const huRoiText = (data: Data, target: string): string[] => {
  const stats = data.cachedStats[target];
  if (
    !stats ||
    stats.isEmptyArea ||
    stats.modalityUnit !== 'HU' ||
    stats.areaUnit !== 'mm²' ||
    !finite(stats.area) ||
    stats.area <= 0 ||
    !finite(stats.mean) ||
    !finite(stats.stdDev) ||
    stats.stdDev < 0
  )
    return ['ROI no válida'];
  return [
    `Área: ${stats.area.toFixed(1)} mm²`,
    `Promedio: ${stats.mean.toFixed(1)} HU`,
    `DE: ${stats.stdDev.toFixed(1)} HU`,
  ];
};
