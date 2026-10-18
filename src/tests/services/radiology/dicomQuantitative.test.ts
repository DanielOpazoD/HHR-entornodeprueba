import { describe, expect, it } from 'vitest';
import { parseDicom } from 'dicom-parser';
import type { Types } from '@cornerstonejs/core';
import {
  hasDicomHuCalibration,
  huProbeText,
  huRoiText,
} from '@/services/radiology/dicomQuantitative';
import { syntheticDicom } from '@/tests/fixtures/syntheticDicom';
const image = {
  preScale: { scaled: true, scalingParameters: { rescaleSlope: 2, rescaleIntercept: -1024 } },
} as Types.IImage;
const data = () =>
  parseDicom(
    syntheticDicom(0, 24, undefined, undefined, undefined, undefined, undefined, {
      slope: '2',
      intercept: '-1024',
    })
  );
describe('verified HU calibration', () => {
  it('requires decoded pixels to have the exact declared calibration', () => {
    expect(hasDicomHuCalibration(data(), image)).toBe(true);
    expect(
      hasDicomHuCalibration(data(), {
        ...image,
        preScale: { ...image.preScale, enabled: true, scaled: false },
      })
    ).toBe(false);
    expect(
      hasDicomHuCalibration(data(), {
        ...image,
        preScale: { scaled: true, scalingParameters: { rescaleSlope: 1, rescaleIntercept: 0 } },
      } as Types.IImage)
    ).toBe(false);
  });
  it.each([
    ['x00281054', 'US'],
    ['x00281053', ''],
    ['x00281053', '0'],
    ['x00281052', 'NaN'],
    ['x00280030', '0\\1'],
    ['x00280030', ''],
    ['x00080060', 'MR'],
    ['x00080016', '1.2.840.10008.5.1.4.1.1.2.1'],
    ['x00280004', 'RGB'],
    ['x00080008', 'ORIGINAL\\PRIMARY\\LOCALIZER'],
  ])('rejects ambiguous calibration %s=%s', (tag, value) => {
    const original = data();
    const changed = {
      ...original,
      string: (key: string) => (key === tag ? value : original.string(key)),
      uint16: original.uint16.bind(original),
    };
    expect(hasDicomHuCalibration(changed, image)).toBe(false);
  });
  it('permits implicit HU only for conventional original CT', () => {
    const original = data();
    const changed = {
      ...original,
      uint16: original.uint16.bind(original),
      string: (key: string) =>
        key === 'x00281054'
          ? undefined
          : key === 'x00080008'
            ? 'ORIGINAL\\PRIMARY\\AXIAL'
            : original.string(key),
    };
    expect(hasDicomHuCalibration(changed, image)).toBe(true);
    expect(
      hasDicomHuCalibration(
        { ...changed, string: key => (key === 'x00189361' ? 'YES' : changed.string(key)) },
        image
      )
    ).toBe(false);
  });
  it.each(['x00280120', 'x00280121', 'x00283000', 'x00409096', 'x52009229', 'x52009230'])(
    'rejects unsupported mapping or padding %s',
    tag => {
      const original = data();
      original.elements[tag] = {} as never;
      expect(hasDicomHuCalibration(original, image)).toBe(false);
    }
  );
});
it('labels only finite calibrated statistics, without fabricating empty or oblique ROIs', () => {
  const stats = { area: 12.5, mean: 42, stdDev: 3, areaUnit: 'mm²', modalityUnit: 'HU' };
  expect(huRoiText({ cachedStats: { test: stats } }, 'test')).toEqual([
    'Área: 12.5 mm²',
    'Promedio: 42.0 HU',
    'DE: 3.0 HU',
  ]);
  for (const invalid of [
    { area: 0 },
    { mean: NaN },
    { stdDev: -1 },
    { areaUnit: 'px²' },
    { isEmptyArea: true },
  ])
    expect(huRoiText({ cachedStats: { test: { ...stats, ...invalid } } }, 'test')).toEqual([
      'ROI no válida',
    ]);
  expect(huProbeText({ cachedStats: { test: { value: 42, modalityUnit: 'HU' } } }, 'test')).toEqual(
    ['42.0 HU']
  );
  expect(
    huProbeText({ cachedStats: { test: { value: NaN, modalityUnit: 'HU' } } }, 'test')
  ).toEqual(['HU no disponible']);
});
