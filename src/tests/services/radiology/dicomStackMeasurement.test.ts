import { afterEach, describe, expect, it } from 'vitest';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import {
  describeDicomStackAnnotation,
  dicomStackTextLines,
  dicomStackToolNames,
} from '@/services/radiology/dicomStackMeasurement';
import { dicomStackShowsHu } from '@/services/radiology/dicomCursorValue';
import {
  findDicomImage,
  registerDicomImage,
  releaseDicomImage,
  type DicomImageInfo,
} from '@/services/radiology/dicomImageRegistry';

const image = (imageId: string, patch: Partial<DicomImageInfo>) =>
  registerDicomImage(imageId, {
    seriesUid: 'synthetic-ct',
    seriesNumber: 3,
    index: 86,
    instanceUid: `${imageId}-sop`,
    modality: 'CT',
    huCalibrated: true,
    color: false,
    spacing: {},
    ...patch,
  });
const stats = {
  area: 120,
  areaUnit: 'mm²',
  mean: 42,
  stdDev: 0,
  min: 42,
  max: 42,
  modalityUnit: 'HU',
};
const roi = (imageId: string) =>
  ({
    annotationUID: `roi-${imageId}`,
    metadata: { toolName: dicomStackToolNames.roi, referencedImageId: imageId },
    data: { handles: { points: [] }, cachedStats: { [`imageId:${imageId}`]: stats } },
  }) as unknown as ToolTypes.Annotation;

afterEach(() => {
  ['dicomfile:801', 'dicomfile:802', 'dicomfile:803', 'dicomfile:804'].forEach(releaseDicomImage);
});

describe('HU in Original and Comparar, image by image', () => {
  it('labels HU only on the validated CT image, never on its uncalibrated neighbour', () => {
    image('dicomfile:801', {});
    image('dicomfile:802', { huCalibrated: false, index: 87 });
    image('dicomfile:803', { modality: 'MR', huCalibrated: false });
    const lines = dicomStackTextLines('ellipse');
    expect(
      lines({ cachedStats: { 'imageId:dicomfile:801': stats } }, 'imageId:dicomfile:801')
    ).toContain('Promedio: 42.0 HU');
    expect(
      lines({ cachedStats: { 'imageId:dicomfile:802': stats } }, 'imageId:dicomfile:802')
    ).toEqual(['Área: 120.0 mm²', 'HU no disponible']);
    expect(
      lines({ cachedStats: { 'imageId:dicomfile:803': stats } }, 'imageId:dicomfile:803').join()
    ).not.toContain('HU');
    // An image this session never verified has no density at all.
    expect(
      lines({ cachedStats: { 'imageId:dicomfile:999': stats } }, 'imageId:dicomfile:999')
    ).toEqual(['Área: 120.0 mm²', 'Valor no disponible']);

    expect(describeDicomStackAnnotation(roi('dicomfile:801'), ['synthetic-ct'])).toMatchObject({
      view: 'original',
      slice: 86,
      seriesNumber: 3,
      value: { density: 'hu', mean: 42 },
    });
    expect(describeDicomStackAnnotation(roi('dicomfile:802'), ['synthetic-ct'])?.value).toEqual({
      kind: 'ellipse',
      area: 120,
      unit: 'mm',
      calibration: '',
      density: 'none',
    });
    // A drawing on a series these panels do not show is not theirs.
    expect(describeDicomStackAnnotation(roi('dicomfile:801'), ['other-series'])).toBeUndefined();
  });

  it('shows the HU under the cursor only on a validated CT image', () => {
    image('dicomfile:801', {});
    image('dicomfile:802', { huCalibrated: false });
    expect(dicomStackShowsHu({ getCurrentImageId: () => 'dicomfile:801' })).toBe(true);
    expect(dicomStackShowsHu({ getCurrentImageId: () => 'dicomfile:802' })).toBe(false);
    expect(dicomStackShowsHu({ getCurrentImageId: () => 'dicomfile:999' })).toBe(false);
  });
});

it('finds the newest load of a reopened instance and forgets released images', () => {
  image('dicomfile:803', { instanceUid: 'shared-sop' });
  image('dicomfile:804', { instanceUid: 'shared-sop' });
  expect(findDicomImage('synthetic-ct', 'shared-sop')).toBe('dicomfile:804');
  releaseDicomImage('dicomfile:804');
  expect(findDicomImage('synthetic-ct', 'shared-sop')).toBe('dicomfile:803');
  expect(findDicomImage('other-series', 'shared-sop')).toBeUndefined();
});
