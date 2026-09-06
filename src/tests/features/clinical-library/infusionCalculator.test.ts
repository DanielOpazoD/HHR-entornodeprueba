import { describe, expect, it } from 'vitest';

import {
  DOSE_UNITS,
  DOSE_UNIT_IDS,
  computeDoseFromRate,
  computeRateFromDose,
  concentrationOf,
  convertDose,
  isUnitCompatibleWithMass,
  massConversionFactor,
  type InfusionDilution,
} from '@/features/clinical-library/domain/infusionCalculator';
import { formatDilutionLabel } from '@/features/clinical-library/controllers/infusionPresentation';
import {
  INFUSION_PRESETS,
  INFUSION_PRESET_GROUP_LABELS,
  assessDoseAgainstRange,
  findInfusionPreset,
} from '@/features/clinical-library/domain/infusionPresets';

const NORADRENALINE_4_250: InfusionDilution = { amount: 4, amountUnit: 'mg', volumeMl: 250 };

const rateOf = (input: Parameters<typeof computeRateFromDose>[0]): number => {
  const result = computeRateFromDose(input);
  if (!result.ok) throw new Error(`unexpected failure ${result.reason}`);
  return result.value.rateMlPerHour;
};

describe('infusion calculator', () => {
  it('parses every dose unit into amount, per-kg and per-minute flags', () => {
    expect(DOSE_UNITS['mcg/kg/min']).toEqual({
      id: 'mcg/kg/min',
      amount: 'mcg',
      perKg: true,
      perMinute: true,
    });
    expect(DOSE_UNITS['UI/h']).toEqual({
      id: 'UI/h',
      amount: 'UI',
      perKg: false,
      perMinute: false,
    });
    expect(DOSE_UNITS['mg/min'].perKg).toBe(false);
    expect(DOSE_UNIT_IDS).toHaveLength(Object.keys(DOSE_UNITS).length);
  });

  it('converts mg and mcg but never units with mass', () => {
    expect(massConversionFactor('mg', 'mcg')).toBe(1000);
    expect(massConversionFactor('mcg', 'mg')).toBe(0.001);
    expect(massConversionFactor('UI', 'UI')).toBe(1);
    expect(massConversionFactor('UI', 'mg')).toBeNull();
    expect(isUnitCompatibleWithMass('UI/kg/h', 'mg')).toBe(false);
    expect(isUnitCompatibleWithMass('mcg/kg/min', 'mg')).toBe(true);
  });

  it('computes pump rates for reference dilutions', () => {
    // Noradrenalina 4 mg/250 mL = 16 mcg/mL; 0,1 mcg/kg/min × 70 kg = 420 mcg/h.
    expect(
      rateOf({ dose: 0.1, unit: 'mcg/kg/min', weightKg: 70, dilution: NORADRENALINE_4_250 })
    ).toBeCloseTo(26.25, 6);
    // Dopamina 400 mg/250 mL = 1600 mcg/mL; 5 mcg/kg/min × 70 kg.
    expect(
      rateOf({
        dose: 5,
        unit: 'mcg/kg/min',
        weightKg: 70,
        dilution: { amount: 400, amountUnit: 'mg', volumeMl: 250 },
      })
    ).toBeCloseTo(13.125, 6);
    // Nitroglicerina 50 mg/250 mL = 200 mcg/mL; 10 mcg/min sin peso.
    expect(
      rateOf({
        dose: 10,
        unit: 'mcg/min',
        dilution: { amount: 50, amountUnit: 'mg', volumeMl: 250 },
      })
    ).toBeCloseTo(3, 6);
    // Heparina 25.000 UI/250 mL = 100 UI/mL; 18 UI/kg/h × 70 kg.
    expect(
      rateOf({
        dose: 18,
        unit: 'UI/kg/h',
        weightKg: 70,
        dilution: { amount: 25000, amountUnit: 'UI', volumeMl: 250 },
      })
    ).toBeCloseTo(12.6, 6);
    // Insulina 100 UI/100 mL; 5 UI/h.
    expect(
      rateOf({ dose: 5, unit: 'UI/h', dilution: { amount: 100, amountUnit: 'UI', volumeMl: 100 } })
    ).toBeCloseTo(5, 6);
    // Propofol 1 % = 10 mg/mL; 2 mg/kg/h × 70 kg.
    expect(
      rateOf({
        dose: 2,
        unit: 'mg/kg/h',
        weightKg: 70,
        dilution: { amount: 1000, amountUnit: 'mg', volumeMl: 100 },
      })
    ).toBeCloseTo(14, 6);
    // Vasopresina 20 UI/100 mL = 0,2 UI/mL; 0,03 UI/min = 1,8 UI/h.
    expect(
      rateOf({
        dose: 0.03,
        unit: 'UI/min',
        dilution: { amount: 20, amountUnit: 'UI', volumeMl: 100 },
      })
    ).toBeCloseTo(9, 6);
  });

  it('inverts a rate back into the same dose', () => {
    const result = computeDoseFromRate({
      rateMlPerHour: 26.25,
      unit: 'mcg/kg/min',
      weightKg: 70,
      dilution: NORADRENALINE_4_250,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dose).toBeCloseTo(0.1, 9);
    expect(result.value.amountPerHour).toBeCloseTo(420, 9);
    expect(result.value.concentration).toEqual({ valuePerMl: 0.016, unit: 'mg' });
  });

  it('fails closed on missing weight, incompatible units and invalid inputs', () => {
    expect(
      computeRateFromDose({ dose: 0.1, unit: 'mcg/kg/min', dilution: NORADRENALINE_4_250 })
    ).toEqual({ ok: false, reason: 'weight_required' });
    expect(computeRateFromDose({ dose: 1, unit: 'UI/h', dilution: NORADRENALINE_4_250 })).toEqual({
      ok: false,
      reason: 'incompatible_units',
    });
    expect(
      computeRateFromDose({
        dose: 1,
        unit: 'mg/h',
        dilution: { amount: 4, amountUnit: 'mg', volumeMl: 0 },
      })
    ).toEqual({ ok: false, reason: 'invalid_dilution' });
    expect(computeRateFromDose({ dose: 0, unit: 'mg/h', dilution: NORADRENALINE_4_250 })).toEqual({
      ok: false,
      reason: 'invalid_dose',
    });
    expect(
      computeRateFromDose({ dose: Number.NaN, unit: 'mg/h', dilution: NORADRENALINE_4_250 })
    ).toEqual({ ok: false, reason: 'invalid_dose' });
    expect(
      computeDoseFromRate({ rateMlPerHour: -1, unit: 'mg/h', dilution: NORADRENALINE_4_250 })
    ).toEqual({ ok: false, reason: 'invalid_rate' });
    expect(concentrationOf({ amount: -4, amountUnit: 'mg', volumeMl: 250 })).toBeNull();
  });

  it('re-expresses doses across units', () => {
    expect(convertDose(0.1, 'mcg/kg/min', 'mcg/min', 70)).toBeCloseTo(7, 9);
    expect(convertDose(0.1, 'mcg/kg/min', 'mcg/h', 70)).toBeCloseTo(420, 9);
    expect(convertDose(0.1, 'mcg/kg/min', 'mg/h', 70)).toBeCloseTo(0.42, 9);
    expect(convertDose(7, 'mcg/min', 'mcg/kg/min', 70)).toBeCloseTo(0.1, 9);
    expect(convertDose(0.1, 'mcg/kg/min', 'mcg/min')).toBeNull();
    expect(convertDose(1, 'UI/h', 'mg/h')).toBeNull();
  });
});

describe('infusion presets', () => {
  it('are internally consistent', () => {
    const ids = INFUSION_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of INFUSION_PRESETS) {
      expect(preset.allowedUnits, preset.id).toContain(preset.defaultUnit);
      expect(preset.allowedUnits, preset.id).toContain(preset.usualRange.unit);
      expect(preset.usualRange.min, preset.id).toBeLessThan(preset.usualRange.max);
      expect(preset.dilutions.length, preset.id).toBeGreaterThan(0);
      expect(INFUSION_PRESET_GROUP_LABELS[preset.group]).toBeTruthy();
      for (const dilution of preset.dilutions) {
        expect(dilution.amount, preset.id).toBeGreaterThan(0);
        expect(dilution.volumeMl, preset.id).toBeGreaterThan(0);
        for (const unit of preset.allowedUnits) {
          expect(isUnitCompatibleWithMass(unit, dilution.amountUnit), `${preset.id} ${unit}`).toBe(
            true
          );
        }
      }
    }
  });

  it('labels dilutions with the derived concentration or the preset hint', () => {
    expect(formatDilutionLabel(findInfusionPreset('noradrenalina')!.dilutions[0])).toBe(
      '4 mg en 250 mL · 16 mcg/mL'
    );
    expect(formatDilutionLabel(findInfusionPreset('midazolam')!.dilutions[0])).toBe(
      '100 mg en 100 mL · 1 mg/mL'
    );
    expect(formatDilutionLabel(findInfusionPreset('heparina')!.dilutions[0])).toBe(
      '25.000 UI en 250 mL · 100 UI/mL'
    );
    expect(findInfusionPreset('unknown')).toBeUndefined();
  });

  it('assesses doses against the usual range across units', () => {
    const range = findInfusionPreset('noradrenalina')!.usualRange;
    expect(assessDoseAgainstRange(0.1, 'mcg/kg/min', range, 70)).toBe('within');
    expect(assessDoseAgainstRange(1, 'mcg/kg/min', range, 70)).toBe('above');
    expect(assessDoseAgainstRange(0.005, 'mcg/kg/min', range, 70)).toBe('below');
    expect(assessDoseAgainstRange(7, 'mcg/min', range, 70)).toBe('within');
    expect(assessDoseAgainstRange(7, 'mcg/min', range, null)).toBe('unknown');
  });
});

/**
 * Tabla dorada escrita a mano: concentración de cada dilución (en mcg/mL para fármacos en mg/mcg,
 * en UI/mL para los biológicos), unidad por defecto y rango habitual. Un error de tipeo en una
 * dilución es el defecto más peligroso del catálogo y debe romper CI.
 */
const GOLDEN_PRESETS: Record<
  string,
  { perMl: number[]; unit: string; defaultUnit: string; range: [number, number]; rangeUnit: string }
> = {
  noradrenalina: {
    perMl: [16, 32, 64],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/min',
    range: [0.01, 0.5],
    rangeUnit: 'mcg/kg/min',
  },
  adrenalina: {
    perMl: [16, 32],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/min',
    range: [0.01, 0.5],
    rangeUnit: 'mcg/kg/min',
  },
  dopamina: {
    perMl: [1600, 800],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/min',
    range: [2, 20],
    rangeUnit: 'mcg/kg/min',
  },
  dobutamina: {
    perMl: [1000, 2000],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/min',
    range: [2, 20],
    rangeUnit: 'mcg/kg/min',
  },
  milrinona: {
    perMl: [200],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/min',
    range: [0.375, 0.75],
    rangeUnit: 'mcg/kg/min',
  },
  vasopresina: {
    perMl: [0.2, 0.4],
    unit: 'UI',
    defaultUnit: 'UI/min',
    range: [0.01, 0.04],
    rangeUnit: 'UI/min',
  },
  nitroglicerina: {
    perMl: [200, 100],
    unit: 'mcg',
    defaultUnit: 'mcg/min',
    range: [5, 200],
    rangeUnit: 'mcg/min',
  },
  nitroprusiato: {
    perMl: [200],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/min',
    range: [0.3, 3],
    rangeUnit: 'mcg/kg/min',
  },
  labetalol: {
    perMl: [1000],
    unit: 'mcg',
    defaultUnit: 'mg/min',
    range: [0.5, 2],
    rangeUnit: 'mg/min',
  },
  amiodarona: {
    perMl: [1800, 2400],
    unit: 'mcg',
    defaultUnit: 'mg/min',
    range: [0.5, 1],
    rangeUnit: 'mg/min',
  },
  midazolam: {
    perMl: [1000, 1000],
    unit: 'mcg',
    defaultUnit: 'mg/kg/h',
    range: [0.02, 0.2],
    rangeUnit: 'mg/kg/h',
  },
  fentanilo: {
    perMl: [10, 50],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/h',
    range: [0.5, 5],
    rangeUnit: 'mcg/kg/h',
  },
  propofol: {
    perMl: [10000, 10000],
    unit: 'mcg',
    defaultUnit: 'mg/kg/h',
    range: [0.3, 3],
    rangeUnit: 'mg/kg/h',
  },
  dexmedetomidina: {
    perMl: [4, 4],
    unit: 'mcg',
    defaultUnit: 'mcg/kg/h',
    range: [0.2, 1.4],
    rangeUnit: 'mcg/kg/h',
  },
  insulina: { perMl: [1, 1], unit: 'UI', defaultUnit: 'UI/h', range: [1, 10], rangeUnit: 'UI/h' },
  heparina: {
    perMl: [100, 50],
    unit: 'UI',
    defaultUnit: 'UI/kg/h',
    range: [12, 18],
    rangeUnit: 'UI/kg/h',
  },
};

describe('infusion preset golden table', () => {
  it('matches every dilution, default unit and usual range written by hand', () => {
    expect(INFUSION_PRESETS.map(preset => preset.id).sort()).toEqual(
      Object.keys(GOLDEN_PRESETS).sort()
    );
    for (const preset of INFUSION_PRESETS) {
      const golden = GOLDEN_PRESETS[preset.id];
      const concentrations = preset.dilutions.map(dilution => {
        const concentration = concentrationOf(dilution)!;
        const factor = concentration.unit === 'mg' ? 1000 : 1;
        return Number((concentration.valuePerMl * factor).toPrecision(12));
      });
      expect(concentrations, preset.id).toEqual(golden.perMl);
      for (const dilution of preset.dilutions) {
        expect(dilution.amountUnit === 'UI' ? 'UI' : 'mcg', preset.id).toBe(golden.unit);
      }
      expect(preset.defaultUnit, preset.id).toBe(golden.defaultUnit);
      expect([preset.usualRange.min, preset.usualRange.max], preset.id).toEqual(golden.range);
      expect(preset.usualRange.unit, preset.id).toBe(golden.rangeUnit);
    }
  });

  it('produces the hand-calculated pump rates at 70 kg for the usual range bounds', () => {
    const at70 = (id: string, dose: number) => {
      const preset = findInfusionPreset(id)!;
      return rateOf({
        dose,
        unit: preset.usualRange.unit,
        weightKg: 70,
        dilution: preset.dilutions[0],
      });
    };
    expect(at70('noradrenalina', 0.01)).toBeCloseTo(2.625, 6);
    expect(at70('noradrenalina', 0.5)).toBeCloseTo(131.25, 6);
    expect(at70('heparina', 12)).toBeCloseTo(8.4, 6);
    expect(at70('heparina', 18)).toBeCloseTo(12.6, 6);
    expect(at70('propofol', 3)).toBeCloseTo(21, 6);
    expect(at70('dexmedetomidina', 1.4)).toBeCloseTo(24.5, 6);
    expect(at70('vasopresina', 0.03)).toBeCloseTo(9, 6);
  });

  it('rejects results that overflow to infinity', () => {
    expect(
      computeRateFromDose({ dose: 1e307, unit: 'mg/h', dilution: NORADRENALINE_4_250 })
    ).toEqual({
      ok: false,
      reason: 'invalid_dose',
    });
    expect(
      computeDoseFromRate({ rateMlPerHour: 1e308, unit: 'mcg/h', dilution: NORADRENALINE_4_250 })
    ).toEqual({ ok: false, reason: 'invalid_rate' });
  });
});
