import { describe, expect, it } from 'vitest';

import { findInfusionPreset } from '@/features/clinical-library/domain/infusionPresets';
import {
  presentInfusion,
  type InfusionPresentationInput,
} from '@/features/clinical-library/controllers/infusionPresentation';

const noradrenaline = findInfusionPreset('noradrenalina')!;

const base: InfusionPresentationInput = {
  mode: 'dose',
  unit: 'mcg/kg/min',
  weightKg: 70,
  dilution: { amount: 4, amountUnit: 'mg', volumeMl: 250 },
  doseText: '0,1',
  rateText: '',
  preset: noradrenaline,
};

describe('infusion presentation', () => {
  it('asks for the missing input before calculating', () => {
    expect(presentInfusion({ ...base, doseText: '' })).toEqual({
      kind: 'idle',
      message: 'Ingresa la dosis para calcular la velocidad de la bomba.',
    });
    expect(presentInfusion({ ...base, mode: 'rate' })).toMatchObject({ kind: 'idle' });
  });

  it('explains every failure in clinical language', () => {
    expect(presentInfusion({ ...base, doseText: 'abc' })).toMatchObject({
      kind: 'error',
      message: 'La dosis debe ser un número mayor que cero.',
    });
    expect(presentInfusion({ ...base, weightKg: null })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('peso'),
    });
    expect(presentInfusion({ ...base, dilution: null })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('dilución'),
    });
    expect(presentInfusion({ ...base, unit: 'UI/h' })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('no es compatible'),
    });
    expect(presentInfusion({ ...base, mode: 'rate', rateText: '0' })).toMatchObject({
      kind: 'error',
      message: 'La velocidad debe ser un número mayor que cero.',
    });
  });

  it('formats the pump rate with equivalents and the usual-range notice', () => {
    const result = presentInfusion(base);
    expect(result.kind).toBe('result');
    if (result.kind !== 'result') return;
    expect(result.primaryValue).toBe('26,3');
    expect(result.primaryUnit).toBe('mL/h');
    expect(result.concentrationLabel).toBe('16 mcg/mL · 4 mg en 250 mL');
    expect(result.equivalents).toEqual(['420 mcg/h en total', '7 mcg/min en total']);
    expect(result.range).toMatchObject({
      assessment: 'within',
      label: 'Dentro del rango habitual (0,01–0,5 mcg/kg/min)',
    });
    expect(result.range?.note).toMatch(/refractario/);
  });

  it('flags doses above the usual range and derives per-kilo equivalents for total units', () => {
    const high = presentInfusion({ ...base, doseText: '1' });
    expect(high.kind === 'result' && high.range?.assessment).toBe('above');
    expect(high.kind === 'result' && high.range?.label).toMatch(/verificar la indicación/);

    const total = presentInfusion({ ...base, unit: 'mcg/min', doseText: '7' });
    expect(total.kind === 'result' && total.equivalents).toEqual([
      '420 mcg/h en total',
      '7 mcg/min en total',
      '0,1 mcg/kg/min',
    ]);
    expect(total.kind === 'result' && total.range?.assessment).toBe('within');
  });

  it('inverts a pump rate into a dose', () => {
    const result = presentInfusion({ ...base, mode: 'rate', rateText: '26,25' });
    expect(result).toMatchObject({
      kind: 'result',
      primaryValue: '0,1',
      primaryUnit: 'mcg/kg/min',
    });
  });

  it('omits the range notice for custom dilutions', () => {
    const result = presentInfusion({ ...base, preset: null });
    expect(result.kind === 'result' && result.range).toBeNull();
  });
});
