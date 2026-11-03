import type { DataSet } from 'dicom-parser';

/** DICOM attributes that Cornerstone's projection-radiograph calibration reads. */
export interface DicomSpacingAttributes {
  sopClass?: string;
  pixelSpacing?: number[];
  imagerPixelSpacing?: number[];
  calibrationType?: string;
  magnification?: number;
  sourceToDetector?: number;
  sourceToPatient?: number;
}

/** What a measurement needs to know about a decoded image. Memory only; no pixels. */
export interface DicomImageInfo {
  seriesUid: string;
  seriesNumber: number;
  index: number;
  instanceUid: string;
  modality: string;
  /** Classic CT with the validated linear HU mapping of `hasDicomHuCalibration`. */
  huCalibrated: boolean;
  color: boolean;
  spacing: DicomSpacingAttributes;
}

const images = new Map<string, DicomImageInfo>();
const listeners = new Set<(info: DicomImageInfo) => void>();

export const registerDicomImage = (imageId: string, info: DicomImageInfo) => {
  images.delete(imageId);
  images.set(imageId, info);
  listeners.forEach(listener => listener(info));
};

export const releaseDicomImage = (imageId: string) => {
  images.delete(imageId);
};

export const dicomImageInfo = (imageId: string | undefined) =>
  imageId ? images.get(imageId) : undefined;

/** The newest load wins: a series reopened before the old one drained keeps the live image. */
export const findDicomImage = (seriesUid: string, instanceUid: string) => {
  let found: string | undefined;
  for (const [imageId, info] of images)
    if (info.seriesUid === seriesUid && info.instanceUid === instanceUid) found = imageId;
  return found;
};

export const onDicomImageRegistered = (listener: (info: DicomImageInfo) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const numbers = (data: DataSet, tag: string) => {
  const values = (data.string(tag) ?? '').split('\\').filter(Boolean).map(Number);
  return values.length && values.every(value => Number.isFinite(value) && value > 0)
    ? values
    : undefined;
};
const positive = (data: DataSet, tag: string) => {
  const value = Number(data.string(tag)?.trim() || NaN);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

export const readDicomSpacingAttributes = (data: DataSet): DicomSpacingAttributes => ({
  sopClass: data.string('x00080016')?.trim(),
  pixelSpacing: numbers(data, 'x00280030'),
  imagerPixelSpacing: numbers(data, 'x00181164'),
  calibrationType: data.string('x00280a02')?.trim() || undefined,
  magnification: positive(data, 'x00181114'),
  sourceToDetector: positive(data, 'x00181110'),
  sourceToPatient: positive(data, 'x00181111'),
});
