/**
 * Fórmulas antropométricas y de dosis por peso usadas en UPC.
 *
 * - Peso ideal: Devine (1974): 50 kg (hombre) / 45,5 kg (mujer) + 2,3 kg por pulgada sobre 5 pies.
 * - Peso ajustado: ideal + 0,4 × (real − ideal); sólo aplica cuando el real supera en ≥ 20 % al ideal.
 * - Superficie corporal: Mosteller (1987): √(talla_cm × peso_kg / 3600).
 * - Clearance de creatinina: Cockcroft-Gault (1976): (140 − edad) × peso / (72 × creatinina), × 0,85 en mujeres.
 */

import { isPositiveFinite } from './numberInput';
import type { MassUnit } from './infusionCalculator';

export type BiologicalSex = 'male' | 'female';

const CM_PER_INCH = 2.54;
const DEVINE_BASE_HEIGHT_CM = 60 * CM_PER_INCH; // 152,4 cm (5 pies)
const DEVINE_KG_PER_INCH = 2.3;

export const computeBmi = (weightKg: number, heightCm: number): number | null =>
  isPositiveFinite(weightKg) && isPositiveFinite(heightCm)
    ? weightKg / (heightCm / 100) ** 2
    : null;

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obesity';

export const classifyBmi = (bmi: number): BmiCategory => {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'overweight';
  return 'obesity';
};

export interface IdealBodyWeightResult {
  kg: number;
  /** Devine se derivó para tallas ≥ 152 cm; bajo eso el resultado es una extrapolación. */
  extrapolated: boolean;
}

export const idealBodyWeightDevine = (
  heightCm: number,
  sex: BiologicalSex
): IdealBodyWeightResult | null => {
  if (!isPositiveFinite(heightCm)) return null;
  const base = sex === 'male' ? 50 : 45.5;
  const inchesOverBase = (heightCm - DEVINE_BASE_HEIGHT_CM) / CM_PER_INCH;
  const kg = base + DEVINE_KG_PER_INCH * inchesOverBase;
  return kg > 0 ? { kg, extrapolated: heightCm < DEVINE_BASE_HEIGHT_CM } : null;
};

export const ADJUSTED_WEIGHT_MIN_RATIO = 1.2;

/** Sólo aplica cuando el peso real supera al ideal en al menos un 20 %; si no, devuelve null. */
export const adjustedBodyWeight = (actualKg: number, idealKg: number): number | null =>
  isPositiveFinite(actualKg) &&
  isPositiveFinite(idealKg) &&
  actualKg >= idealKg * ADJUSTED_WEIGHT_MIN_RATIO
    ? idealKg + 0.4 * (actualKg - idealKg)
    : null;

export const bodySurfaceAreaMosteller = (weightKg: number, heightCm: number): number | null =>
  isPositiveFinite(weightKg) && isPositiveFinite(heightCm)
    ? Math.sqrt((heightCm * weightKg) / 3600)
    : null;

export interface CockcroftGaultInput {
  ageYears: number;
  weightKg: number;
  creatinineMgDl: number;
  sex: BiologicalSex;
}

export const cockcroftGaultClearance = (input: CockcroftGaultInput): number | null => {
  if (
    !isPositiveFinite(input.ageYears) ||
    !isPositiveFinite(input.weightKg) ||
    !isPositiveFinite(input.creatinineMgDl) ||
    input.ageYears < 18 ||
    input.ageYears >= 140
  ) {
    return null;
  }
  const base = ((140 - input.ageYears) * input.weightKg) / (72 * input.creatinineMgDl);
  return input.sex === 'female' ? base * 0.85 : base;
};

export type WeightBasis = 'actual' | 'ideal' | 'adjusted';

export interface WeightBasedDoseInput {
  dosePerKg: number;
  doseUnit: MassUnit;
  weightKg: number;
  /** Concentración de la presentación (p. ej. 40 mg en 2 mL) para obtener el volumen a administrar. */
  presentation?: { amount: number; volumeMl: number } | null;
}

export interface WeightBasedDoseOutput {
  totalDose: number;
  doseUnit: MassUnit;
  volumeMl: number | null;
}

export const computeWeightBasedDose = (
  input: WeightBasedDoseInput
): WeightBasedDoseOutput | null => {
  if (!isPositiveFinite(input.dosePerKg) || !isPositiveFinite(input.weightKg)) return null;
  const totalDose = input.dosePerKg * input.weightKg;
  const presentation = input.presentation;
  const volumeMl =
    presentation && isPositiveFinite(presentation.amount) && isPositiveFinite(presentation.volumeMl)
      ? (totalDose * presentation.volumeMl) / presentation.amount
      : null;
  return { totalDose, doseUnit: input.doseUnit, volumeMl };
};
