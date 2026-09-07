/**
 * Rangos plausibles para las entradas de las calculadoras. Un valor fuera de rango
 * (p. ej. talla «1,70» en metros o peso negativo) no se usa para calcular y se marca
 * en el campo, en vez de producir un IMC de 242 o una dosis negativa.
 */

import { parseLocalizedDecimal } from '../domain/numberInput';
import { formatClinicalNumber } from './libraryPresentation';

export interface PlausibleRange {
  min: number;
  max: number;
  unit: string;
}

export const PLAUSIBLE_RANGES = {
  weightKg: { min: 0.5, max: 400, unit: 'kg' },
  heightCm: { min: 30, max: 250, unit: 'cm' },
  ageYears: { min: 0, max: 120, unit: 'años' },
  creatinineMgDl: { min: 0.1, max: 30, unit: 'mg/dL' },
} as const satisfies Record<string, PlausibleRange>;

export interface PlausibleInput {
  /** Valor numérico válido y dentro de rango; null si está vacío, no es número o está fuera. */
  value: number | null;
  /** true sólo cuando hay un número escrito pero fuera del rango plausible. */
  invalid: boolean;
}

export const plausibleValue = (text: string, range: PlausibleRange): PlausibleInput => {
  const parsed = parseLocalizedDecimal(text);
  if (parsed === null) return { value: null, invalid: false };
  const inRange = parsed >= range.min && parsed <= range.max;
  return { value: inRange ? parsed : null, invalid: !inRange };
};

export const rangeHint = (input: PlausibleInput, range: PlausibleRange): string | undefined =>
  input.invalid
    ? `Fuera del rango plausible (${formatClinicalNumber(range.min)}–${formatClinicalNumber(range.max)} ${range.unit}).`
    : undefined;
