/**
 * Cálculo puro de velocidad de infusión.
 *
 *   mL/h = dosis × (peso si es por kg) × (60 si es por minuto) ÷ concentración (masa/mL)
 *
 * Las masas se expresan en mg, mcg o UI. mg y mcg son conmensurables (×1000);
 * las UI sólo con UI. Ningún cálculo redondea: la presentación decide los decimales.
 */

import { isPositiveFinite } from './numberInput';

export const MASS_UNITS = ['mg', 'mcg', 'UI'] as const;
export type MassUnit = (typeof MASS_UNITS)[number];

export const DOSE_UNIT_IDS = [
  'mcg/kg/min',
  'mcg/kg/h',
  'mg/kg/h',
  'mcg/min',
  'mcg/h',
  'mg/min',
  'mg/h',
  'UI/h',
  'UI/kg/h',
  'UI/min',
] as const;
export type DoseUnitId = (typeof DOSE_UNIT_IDS)[number];

export interface DoseUnitDefinition {
  id: DoseUnitId;
  amount: MassUnit;
  perKg: boolean;
  perMinute: boolean;
}

const defineUnit = (id: DoseUnitId): DoseUnitDefinition => {
  const [amount, ...rest] = id.split('/') as [MassUnit, ...string[]];
  return {
    id,
    amount,
    perKg: rest.includes('kg'),
    perMinute: rest[rest.length - 1] === 'min',
  };
};

export const DOSE_UNITS: Readonly<Record<DoseUnitId, DoseUnitDefinition>> = Object.fromEntries(
  DOSE_UNIT_IDS.map(id => [id, defineUnit(id)])
) as Record<DoseUnitId, DoseUnitDefinition>;

export interface InfusionDilution {
  amount: number;
  amountUnit: MassUnit;
  volumeMl: number;
}

export interface InfusionConcentration {
  valuePerMl: number;
  unit: MassUnit;
}

export type InfusionFailure =
  | 'invalid_dilution'
  | 'invalid_dose'
  | 'invalid_rate'
  | 'weight_required'
  | 'incompatible_units';

export type InfusionResult<T> = { ok: true; value: T } | { ok: false; reason: InfusionFailure };

const fail = <T>(reason: InfusionFailure): InfusionResult<T> => ({ ok: false, reason });

export const concentrationOf = (dilution: InfusionDilution): InfusionConcentration | null =>
  isPositiveFinite(dilution.amount) && isPositiveFinite(dilution.volumeMl)
    ? { valuePerMl: dilution.amount / dilution.volumeMl, unit: dilution.amountUnit }
    : null;

/** Factor para pasar de `from` a `to`; null cuando no son conmensurables (UI frente a masa). */
export const massConversionFactor = (from: MassUnit, to: MassUnit): number | null => {
  if (from === to) return 1;
  if (from === 'mg' && to === 'mcg') return 1000;
  if (from === 'mcg' && to === 'mg') return 0.001;
  return null;
};

export const isUnitCompatibleWithMass = (unit: DoseUnitId, mass: MassUnit): boolean =>
  massConversionFactor(DOSE_UNITS[unit].amount, mass) !== null;

export interface RateFromDoseInput {
  dose: number;
  unit: DoseUnitId;
  weightKg?: number | null;
  dilution: InfusionDilution;
}

export interface RateFromDoseOutput {
  rateMlPerHour: number;
  concentration: InfusionConcentration;
  /** Masa total por hora en la unidad de la dosis (mg, mcg o UI). */
  amountPerHour: number;
}

export const computeRateFromDose = (
  input: RateFromDoseInput
): InfusionResult<RateFromDoseOutput> => {
  const concentration = concentrationOf(input.dilution);
  if (!concentration) return fail('invalid_dilution');
  if (!isPositiveFinite(input.dose)) return fail('invalid_dose');
  const unit = DOSE_UNITS[input.unit];
  const factor = massConversionFactor(unit.amount, concentration.unit);
  if (factor === null) return fail('incompatible_units');
  if (unit.perKg && !isPositiveFinite(input.weightKg)) return fail('weight_required');
  const weight = unit.perKg && input.weightKg ? input.weightKg : 1;
  const amountPerHour = input.dose * weight * (unit.perMinute ? 60 : 1);
  const rateMlPerHour = (amountPerHour * factor) / concentration.valuePerMl;
  if (!Number.isFinite(rateMlPerHour)) return fail('invalid_dose');
  return { ok: true, value: { rateMlPerHour, concentration, amountPerHour } };
};

export interface DoseFromRateInput {
  rateMlPerHour: number;
  unit: DoseUnitId;
  weightKg?: number | null;
  dilution: InfusionDilution;
}

export interface DoseFromRateOutput {
  dose: number;
  concentration: InfusionConcentration;
  amountPerHour: number;
}

export const computeDoseFromRate = (
  input: DoseFromRateInput
): InfusionResult<DoseFromRateOutput> => {
  const concentration = concentrationOf(input.dilution);
  if (!concentration) return fail('invalid_dilution');
  if (!isPositiveFinite(input.rateMlPerHour)) return fail('invalid_rate');
  const unit = DOSE_UNITS[input.unit];
  const factor = massConversionFactor(concentration.unit, unit.amount);
  if (factor === null) return fail('incompatible_units');
  if (unit.perKg && !isPositiveFinite(input.weightKg)) return fail('weight_required');
  const weight = unit.perKg && input.weightKg ? input.weightKg : 1;
  const amountPerHour = input.rateMlPerHour * concentration.valuePerMl * factor;
  const dose = amountPerHour / weight / (unit.perMinute ? 60 : 1);
  if (!Number.isFinite(dose) || !Number.isFinite(amountPerHour)) return fail('invalid_rate');
  return { ok: true, value: { dose, concentration, amountPerHour } };
};

/** Reexpresa una dosis en otra unidad (p. ej. mcg/kg/min → mcg/min). */
export const convertDose = (
  dose: number,
  from: DoseUnitId,
  to: DoseUnitId,
  weightKg?: number | null
): number | null => {
  const source = DOSE_UNITS[from];
  const target = DOSE_UNITS[to];
  const factor = massConversionFactor(source.amount, target.amount);
  if (factor === null || !Number.isFinite(dose)) return null;
  if ((source.perKg || target.perKg) && !isPositiveFinite(weightKg)) return null;
  const weight = weightKg ?? 1;
  const amountPerHour = dose * (source.perKg ? weight : 1) * (source.perMinute ? 60 : 1) * factor;
  return amountPerHour / (target.perKg ? weight : 1) / (target.perMinute ? 60 : 1);
};
