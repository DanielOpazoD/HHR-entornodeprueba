import { describe, expect, it } from 'vitest';

import {
  adjustedBodyWeight,
  bodySurfaceAreaMosteller,
  classifyBmi,
  cockcroftGaultClearance,
  computeBmi,
  computeWeightBasedDose,
  idealBodyWeightDevine,
} from '@/features/clinical-library/domain/doseCalculator';

describe('dose calculator', () => {
  it('computes BMI and its category', () => {
    expect(computeBmi(70, 170)).toBeCloseTo(24.22, 2);
    expect(classifyBmi(17)).toBe('underweight');
    expect(classifyBmi(24.9)).toBe('normal');
    expect(classifyBmi(25)).toBe('overweight');
    expect(classifyBmi(30)).toBe('obesity');
    expect(computeBmi(0, 170)).toBeNull();
  });

  it('computes Devine ideal body weight in centimetres', () => {
    expect(idealBodyWeightDevine(170, 'male')?.kg).toBeCloseTo(65.94, 2);
    expect(idealBodyWeightDevine(160, 'female')?.kg).toBeCloseTo(52.38, 2);
    expect(idealBodyWeightDevine(152.4, 'male')).toEqual({ kg: 50, extrapolated: false });
    expect(idealBodyWeightDevine(140, 'female')?.extrapolated).toBe(true);
    expect(idealBodyWeightDevine(-1, 'male')).toBeNull();
  });

  it('computes adjusted body weight only from 20 % above ideal weight', () => {
    expect(adjustedBodyWeight(100, 65.94)).toBeCloseTo(79.56, 2);
    expect(adjustedBodyWeight(65.94 * 1.2, 65.94)).toBeCloseTo(71.215, 2);
    expect(adjustedBodyWeight(75, 65.94)).toBeNull();
    expect(adjustedBodyWeight(60, 65.94)).toBeNull();
    expect(adjustedBodyWeight(65.94, 65.94)).toBeNull();
  });

  it('computes Mosteller body surface area', () => {
    expect(bodySurfaceAreaMosteller(70, 170)).toBeCloseTo(1.818, 3);
    expect(bodySurfaceAreaMosteller(70, 0)).toBeNull();
  });

  it('computes Cockcroft-Gault clearance with the female correction', () => {
    expect(
      cockcroftGaultClearance({ ageYears: 60, weightKg: 70, creatinineMgDl: 1, sex: 'male' })
    ).toBeCloseTo(77.78, 2);
    expect(
      cockcroftGaultClearance({ ageYears: 60, weightKg: 70, creatinineMgDl: 1, sex: 'female' })
    ).toBeCloseTo(66.11, 2);
    expect(
      cockcroftGaultClearance({ ageYears: 140, weightKg: 70, creatinineMgDl: 1, sex: 'male' })
    ).toBeNull();
    expect(
      cockcroftGaultClearance({ ageYears: 5, weightKg: 20, creatinineMgDl: 0.5, sex: 'male' })
    ).toBeNull();
    expect(
      cockcroftGaultClearance({ ageYears: 60, weightKg: 70, creatinineMgDl: 0, sex: 'male' })
    ).toBeNull();
  });

  it('computes weight-based doses and the volume for a presentation', () => {
    expect(computeWeightBasedDose({ dosePerKg: 1.5, doseUnit: 'mg', weightKg: 70 })).toEqual({
      totalDose: 105,
      doseUnit: 'mg',
      volumeMl: null,
    });
    expect(
      computeWeightBasedDose({
        dosePerKg: 1.5,
        doseUnit: 'mg',
        weightKg: 70,
        presentation: { amount: 40, volumeMl: 2 },
      })?.volumeMl
    ).toBeCloseTo(5.25, 9);
    expect(computeWeightBasedDose({ dosePerKg: 0, doseUnit: 'mg', weightKg: 70 })).toBeNull();
    expect(
      computeWeightBasedDose({
        dosePerKg: 1,
        doseUnit: 'mg',
        weightKg: 70,
        presentation: { amount: 0, volumeMl: 2 },
      })?.volumeMl
    ).toBeNull();
  });
});
