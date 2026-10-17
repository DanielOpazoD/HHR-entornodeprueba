import { describe, expect, it } from 'vitest';
import { volumeImageOrder, type SliceGeometry } from '@/domain/radiology/dicomGeometry';

const slices = (): SliceGeometry[] =>
  Array.from({ length: 4 }, (_, i) => ({
    imageId: `synthetic-${i}`,
    position: [0, 0, i * 2],
    orientation: [1, 0, 0, 0, 1, 0],
    spacing: [1, 1],
    frame: 'synthetic-frame',
    rows: 64,
    columns: 64,
  }));
describe('DICOM volume geometry', () => {
  it('orders actual patient-space positions rather than trusting instance numbers', () => {
    const images = slices().reverse();
    expect(volumeImageOrder(images)).toEqual([
      'synthetic-0',
      'synthetic-1',
      'synthetic-2',
      'synthetic-3',
    ]);
    const oblique = slices().map((slice, i) => ({
      ...slice,
      orientation: [0, 1, 0, 0, 0, 1],
      position: [i * 2, 0, 0],
    }));
    expect(volumeImageOrder(oblique.reverse())).toEqual([
      'synthetic-0',
      'synthetic-1',
      'synthetic-2',
      'synthetic-3',
    ]);
  });
  it.each([
    'duplicate',
    'missing',
    'tilt',
    'orientation',
    'frame',
    'spacing',
    'dimensions',
    'nan',
  ] as const)('rejects %s geometry instead of displaying a misleading reconstruction', failure => {
    const images = slices();
    if (failure === 'duplicate') images[1].position = [0, 0, 0];
    if (failure === 'missing') images[3].position = [0, 0, 8];
    if (failure === 'tilt') images[1].position = [1, 0, 2];
    if (failure === 'orientation') images[1].orientation = [0, 1, 0, 1, 0, 0];
    if (failure === 'frame') images[1].frame = 'other-frame';
    if (failure === 'spacing') images[1].spacing = [2, 2];
    if (failure === 'dimensions') images[1].rows = 128;
    if (failure === 'nan') images[1].position = [0, 0, NaN];
    expect(() => volumeImageOrder(images)).toThrow();
  });
});
