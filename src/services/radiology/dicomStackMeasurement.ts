import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { dicomImageInfo } from './dicomImageRegistry';
import type { DicomMeasurement } from './dicomMeasurementStore';
import {
  dicomDensity,
  dicomMeasurementLines,
  readDicomMeasurement,
  type DicomMeasurementKind,
} from './dicomMeasurementText';

/** Tool names of Original and Comparar, apart from MPR's on the same frame of reference. */
export const dicomStackToolNames = {
  length: 'DicomStackLength',
  angle: 'DicomStackAngle',
  cobb: 'DicomStackCobbAngle',
  probe: 'DicomStackProbe',
  roi: 'DicomStackEllipticalROI',
  rectangle: 'DicomStackRectangleROI',
  circle: 'DicomStackCircleROI',
} as const;
export type DicomStackMeasureTool = keyof typeof dicomStackToolNames;
const kindOf: Record<DicomStackMeasureTool, DicomMeasurementKind> = {
  length: 'length',
  angle: 'angle',
  cobb: 'cobb',
  probe: 'probe',
  roi: 'ellipse',
  rectangle: 'rectangle',
  circle: 'circle',
};
export const dicomStackToolKinds: Record<string, DicomMeasurementKind> = Object.fromEntries(
  Object.entries(dicomStackToolNames).map(([tool, name]) => [
    name,
    kindOf[tool as DicomStackMeasureTool],
  ])
);

type Stats = Record<string, Record<string, unknown>>;
const imageOf = (target: string) => (target.startsWith('imageId:') ? target.slice(8) : undefined);

/** Text beside each drawing. HU only for an image that passed `hasDicomHuCalibration`. */
export const dicomStackTextLines =
  (kind: DicomMeasurementKind) => (data: { cachedStats: Stats }, target: string) => {
    const info = dicomImageInfo(imageOf(target));
    const value = readDicomMeasurement(kind, data.cachedStats[target], dicomDensity(info));
    return dicomMeasurementLines(kind, value, info?.modality ?? '');
  };

/** The stored record of a drawing on one of these series, with the same density rule. */
export const describeDicomStackAnnotation = (
  annotation: ToolTypes.Annotation,
  seriesUids: string[]
): Omit<DicomMeasurement, 'annotation' | 'points'> | undefined => {
  const imageId = annotation.metadata?.referencedImageId;
  const info = dicomImageInfo(imageId);
  const kind = dicomStackToolKinds[annotation.metadata?.toolName ?? ''];
  if (!info || !kind || !annotation.annotationUID || !seriesUids.includes(info.seriesUid))
    return undefined;
  const stats = (annotation.data.cachedStats as Stats | undefined)?.[`imageId:${imageId}`];
  return {
    id: annotation.annotationUID,
    kind,
    seriesUid: info.seriesUid,
    seriesNumber: info.seriesNumber,
    modality: info.modality,
    view: 'original',
    slice: info.index,
    instanceUid: info.instanceUid,
    value: readDicomMeasurement(kind, stats, dicomDensity(info)),
  };
};
