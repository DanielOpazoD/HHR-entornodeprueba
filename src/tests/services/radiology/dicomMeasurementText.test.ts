import { describe, expect, it } from 'vitest';
import {
  dicomCalibrationLabel,
  dicomDecimal,
  dicomDensity,
  dicomMeasurementLines,
  dicomMeasurementSummary,
  parseDicomUnit,
  readDicomMeasurement,
} from '@/services/radiology/dicomMeasurementText';

const roi = {
  area: 120,
  areaUnit: 'mm²',
  mean: 35.4,
  stdDev: 8.2,
  min: 20,
  max: 51,
  modalityUnit: 'HU',
};

describe('density shown for each image', () => {
  it('shows HU only for CT that passed the HU calibration check', () => {
    expect(dicomDensity({ modality: 'CT', huCalibrated: true, color: false })).toBe('hu');
    expect(dicomDensity({ modality: 'CT', huCalibrated: false, color: false })).toBe('none');
    expect(dicomDensity({ modality: 'MR', huCalibrated: false, color: false })).toBe('pixel');
    expect(dicomDensity({ modality: 'DX', huCalibrated: false, color: false })).toBe('pixel');
    // A colour image or an unknown image has no single density.
    expect(dicomDensity({ modality: 'US', huCalibrated: false, color: true })).toBe('none');
    expect(dicomDensity(undefined)).toBe('none');
  });

  it('never labels HU when Cornerstone itself does not report HU', () => {
    expect(readDicomMeasurement('probe', { value: 42, modalityUnit: '' }, 'hu')).toEqual({
      kind: 'probe',
      density: 'none',
    });
    expect(readDicomMeasurement('ellipse', { ...roi, modalityUnit: 'raw' }, 'hu')?.density).toBe(
      'none'
    );
  });

  it('keeps an uncalibrated CT ROI area but drops its statistics', () => {
    const value = readDicomMeasurement(
      'ellipse',
      roi,
      dicomDensity({
        modality: 'CT',
        huCalibrated: false,
        color: false,
      })
    );
    expect(value).toEqual({
      kind: 'ellipse',
      area: 120,
      unit: 'mm',
      calibration: '',
      density: 'none',
    });
    expect(dicomMeasurementLines('ellipse', value, 'CT')).toEqual([
      'Área: 120.0 mm²',
      'HU no disponible',
    ]);
    expect(dicomMeasurementSummary('ellipse', value, 'CT')).toBe(
      'ROI, área 1,2 cm² (UH no disponible)'
    );
  });

  it('labels RX and MR values as pixel values without a unit', () => {
    const probe = readDicomMeasurement('probe', { value: 412.4, modalityUnit: '' }, 'pixel');
    expect(dicomMeasurementLines('probe', probe, 'MR')).toEqual(['Valor de píxel: 412.4']);
    expect(dicomMeasurementSummary('probe', probe, 'MR')).toBe('valor de píxel 412');
    const area = readDicomMeasurement('rectangle', { ...roi, modalityUnit: '' }, 'pixel');
    expect(dicomMeasurementLines('rectangle', area, 'DX')).toEqual([
      'Área: 120.0 mm²',
      'Valor de píxel: 35.4',
      'DE: 8.2',
      'Mín/Máx: 20 / 51',
    ]);
    expect(dicomMeasurementSummary('rectangle', area, 'DX')).toBe(
      'ROI rectangular valor de píxel 35 (DE 8), área 1,2 cm²'
    );
  });

  it('reports calibrated CT statistics with HU', () => {
    const value = readDicomMeasurement('circle', roi, 'hu');
    expect(dicomMeasurementLines('circle', value, 'CT')).toEqual([
      'Área: 120.0 mm²',
      'Promedio: 35.4 HU',
      'DE: 8.2 HU',
      'Mín/Máx: 20 / 51 HU',
    ]);
    expect(dicomMeasurementSummary('circle', value, 'CT')).toBe(
      'ROI circular 35 UH (DE 8), área 1,2 cm²'
    );
    const probe = readDicomMeasurement('probe', { value: -3.6, modalityUnit: 'HU' }, 'hu');
    expect(dicomMeasurementLines('probe', probe, 'CT')).toEqual(['-3.6 HU']);
    expect(dicomMeasurementSummary('probe', probe, 'CT')).toBe('densidad -4 UH');
  });

  it.each([
    [{ ...roi, area: 0 }],
    [{ ...roi, isEmptyArea: true }],
    [{ ...roi, areaUnit: 'cm US Region' }],
    [{ ...roi, area: Number.NaN }],
  ])('rejects ROIs without a valid area: %o', stats => {
    const value = readDicomMeasurement('ellipse', stats, 'hu');
    expect(value).toEqual({ kind: 'ellipse', invalid: true });
    expect(dicomMeasurementLines('ellipse', value, 'CT')).toEqual(['ROI no válida']);
  });

  it('drops statistics that are not finite or have a negative deviation', () => {
    expect(readDicomMeasurement('ellipse', { ...roi, mean: Number.NaN }, 'hu')?.density).toBe(
      'none'
    );
    expect(readDicomMeasurement('ellipse', { ...roi, stdDev: -1 }, 'hu')?.density).toBe('none');
    // An RGB voxel reads as an array, never as a density.
    expect(readDicomMeasurement('probe', { value: [1, 2, 3], modalityUnit: '' }, 'pixel')).toBe(
      undefined
    );
  });
});

describe('distance units and calibration labels', () => {
  it('parses Cornerstone units and keeps its calibration label', () => {
    expect(parseDicomUnit('mm')).toEqual({ unit: 'mm', calibration: '' });
    expect(parseDicomUnit('mm Proj')).toEqual({ unit: 'mm', calibration: 'Proj' });
    expect(parseDicomUnit('mm² ERMF')).toEqual({ unit: 'mm', calibration: 'ERMF' });
    expect(parseDicomUnit('px')).toEqual({ unit: 'px', calibration: '' });
    expect(parseDicomUnit('px²')).toEqual({ unit: 'px', calibration: '' });
    expect(parseDicomUnit('cm US Region')).toBeUndefined();
    expect(parseDicomUnit(undefined)).toBeUndefined();
  });

  it.each([
    ['mm', ''],
    ['mm ERMF', 'en paciente, ERMF'],
    ['mm Calibrated', 'calibrada con referencia'],
    ['mm Proj', 'en detector'],
    ['mm Unknown', 'calibración no declarada'],
    ['px', 'sin calibrar'],
    ['px Unknown', 'sin calibrar'],
  ])('labels %s as «%s»', (unit, label) => {
    expect(dicomCalibrationLabel(parseDicomUnit(unit)!)).toBe(label);
  });

  it('never presents pixels as millimetres', () => {
    const pixels = readDicomMeasurement('length', { length: 85.4, unit: 'px' }, 'none');
    expect(dicomMeasurementLines('length', pixels, 'DX')).toEqual(['85.4 px (sin calibrar)']);
    expect(dicomMeasurementSummary('length', pixels, 'DX')).toBe('distancia 85 px (sin calibrar)');
    const area = readDicomMeasurement(
      'rectangle',
      { ...roi, areaUnit: 'px²', area: 1200 },
      'pixel'
    );
    expect(dicomMeasurementSummary('rectangle', area, 'DX')).toMatch(
      /área 1200 px² \(sin calibrar\)$/
    );
  });

  it('writes distances with their calibration place', () => {
    const detector = readDicomMeasurement('length', { length: 12.44, unit: 'mm Proj' }, 'none');
    expect(dicomMeasurementLines('length', detector, 'DX')).toEqual(['12.4 mm (en detector)']);
    expect(dicomMeasurementSummary('length', detector, 'DX')).toBe(
      'distancia 12,4 mm (en detector)'
    );
    const patient = readDicomMeasurement('length', { length: 9.96, unit: 'mm ERMF' }, 'none');
    expect(dicomMeasurementSummary('length', patient, 'DX')).toBe(
      'distancia 10,0 mm (en paciente, ERMF)'
    );
    expect(
      dicomMeasurementSummary(
        'length',
        readDicomMeasurement('length', { length: 12.44, unit: 'mm' }, 'hu'),
        'CT'
      )
    ).toBe('distancia 12,4 mm');
  });
});

it('writes angles and Spanish decimals', () => {
  expect(dicomMeasurementLines('angle', { kind: 'angle', angle: 35.24 }, 'DX')).toEqual(['35.2°']);
  expect(dicomMeasurementSummary('cobb', { kind: 'cobb', angle: 23.46 }, 'DX')).toBe(
    'ángulo de Cobb 23,5°'
  );
  expect(readDicomMeasurement('angle', { angle: 'Incomplete Angle' }, 'none')).toBeUndefined();
  expect(dicomDecimal(-0.04, 1)).toBe('0,0');
  expect(dicomDecimal(1234.56, 1)).toBe('1234,6');
});
