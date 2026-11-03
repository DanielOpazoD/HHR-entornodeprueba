import { expect, it } from 'vitest';
import {
  createDicomMeasurementStore,
  type DicomMeasurement,
} from '@/services/radiology/dicomMeasurementStore';
import {
  dicomMeasurementPlace,
  dicomMeasurementsText,
} from '@/services/radiology/dicomMeasurementReport';

const measurement = (patch: Partial<DicomMeasurement>): DicomMeasurement => ({
  id: crypto.randomUUID(),
  kind: 'length',
  seriesUid: 'synthetic-series-3',
  seriesNumber: 3,
  modality: 'CT',
  view: 'original',
  slice: 86,
  points: [],
  annotation: {},
  ...patch,
});

it('copies one line per slice in the owner example format', () => {
  const items = [
    measurement({ value: { kind: 'length', length: 12.44, unit: 'mm', calibration: '' } }),
    measurement({
      kind: 'ellipse',
      value: {
        kind: 'ellipse',
        area: 120,
        unit: 'mm',
        calibration: '',
        density: 'hu',
        mean: 35.2,
        stdDev: 7.8,
      },
    }),
    measurement({
      kind: 'angle',
      slice: 40,
      view: 'coronal',
      oblique: true,
      value: { kind: 'angle', angle: 31.26 },
    }),
    measurement({
      kind: 'length',
      seriesUid: 'synthetic-series-5',
      seriesNumber: 5,
      modality: 'DX',
      slice: 0,
      value: { kind: 'length', length: 81.25, unit: 'mm', calibration: 'Proj' },
    }),
  ];
  expect(dicomMeasurementsText(items, 'TC tórax')).toBe(
    [
      'TC tórax, serie 3, corte 87: distancia 12,4 mm; ROI 35 UH (DE 8), área 1,2 cm²',
      'TC tórax, serie 3, MPR coronal oblicuo, corte 41: ángulo 31,3°',
      'TC tórax, serie 5, corte 1: distancia 81,3 mm (en detector)',
    ].join('\n')
  );
});

it('carries no patient identifiers and drops a missing exam name', () => {
  const text = dicomMeasurementsText(
    [measurement({ value: { kind: 'length', length: 5, unit: 'px', calibration: '' } })],
    '  '
  );
  expect(text).toBe('serie 3, corte 87: distancia 5 px (sin calibrar)');
  expect(dicomMeasurementPlace(measurement({ view: 'sagittal', slice: 0 }))).toBe(
    'serie 3, MPR sagital, corte 1'
  );
});

it('keeps measurements for the viewer only, in drawing order, with context undo', () => {
  const store = createDicomMeasurementStore();
  const seen: number[] = [];
  const stop = store.subscribe(items => seen.push(items.length));
  const first = measurement({ id: 'a' });
  store.upsert(first);
  store.upsert(measurement({ id: 'b', view: 'axial' }));
  store.upsert(measurement({ id: 'c' }));
  // Editing a measurement keeps its place in the list.
  store.upsert({ ...first, slice: 3 });
  expect(store.list().map(item => item.id)).toEqual(['a', 'b', 'c']);
  expect(store.get('a')?.slice).toBe(3);
  store.undo(item => item.view === 'axial');
  expect(store.list().map(item => item.id)).toEqual(['a', 'c']);
  store.undo(item => item.view === 'original');
  expect(store.list().map(item => item.id)).toEqual(['a']);
  store.undo(item => item.view === 'axial');
  expect(store.list().map(item => item.id)).toEqual(['a']);
  store.clear();
  expect(store.list()).toEqual([]);
  stop();
  store.upsert(measurement({ id: 'd' }));
  expect(seen).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
});
