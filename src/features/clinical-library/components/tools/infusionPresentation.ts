/**
 * Traduce el estado del formulario de infusión a un resultado presentable.
 * Es puro para poder probar cada mensaje y cada número sin montar el componente.
 */

import {
  DOSE_UNITS,
  computeDoseFromRate,
  computeRateFromDose,
  type DoseUnitId,
  type InfusionConcentration,
  type InfusionDilution,
  type InfusionFailure,
} from '../../domain/infusionCalculator';
import {
  assessDoseAgainstRange,
  type DoseRangeAssessment,
  type InfusionPreset,
} from '../../domain/infusionPresets';
import { parseLocalizedDecimal } from '../../domain/numberInput';
import { formatClinicalNumber } from '../libraryPresentation';

export type InfusionMode = 'dose' | 'rate';

export interface InfusionPresentationInput {
  mode: InfusionMode;
  unit: DoseUnitId;
  weightKg: number | null;
  dilution: InfusionDilution | null;
  doseText: string;
  rateText: string;
  preset: InfusionPreset | null;
}

export interface InfusionRangeNotice {
  assessment: DoseRangeAssessment;
  label: string;
  note?: string;
}

export type InfusionPresentation =
  | { kind: 'idle'; message: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'result';
      primaryValue: string;
      primaryUnit: string;
      concentrationLabel: string;
      equivalents: string[];
      range: InfusionRangeNotice | null;
    };

const FAILURE_MESSAGES: Readonly<Record<InfusionFailure, string>> = {
  invalid_dilution: 'Ingresa la cantidad de fármaco y el volumen de la dilución.',
  invalid_dose: 'La dosis debe ser un número mayor que cero.',
  invalid_rate: 'La velocidad debe ser un número mayor que cero.',
  weight_required: 'Ingresa el peso del paciente: la unidad elegida es por kilo.',
  incompatible_units:
    'La unidad de dosis no es compatible con la dilución (unidades internacionales frente a mg o mcg).',
};

const formatRate = (rate: number): string =>
  formatClinicalNumber(rate, rate >= 100 ? 0 : rate >= 10 ? 1 : 2);

/** Muestra la concentración en la unidad más legible: 0,016 mg/mL se lee como 16 mcg/mL. */
export const formatConcentration = (concentration: InfusionConcentration): string => {
  let { valuePerMl, unit } = concentration;
  if (unit === 'mg' && valuePerMl < 1) {
    valuePerMl *= 1000;
    unit = 'mcg';
  } else if (unit === 'mcg' && valuePerMl >= 1000) {
    valuePerMl /= 1000;
    unit = 'mg';
  }
  return `${formatClinicalNumber(valuePerMl)} ${unit}/mL`;
};

const concentrationLabel = (
  concentration: InfusionConcentration,
  dilution: InfusionDilution
): string =>
  `${formatConcentration(concentration)} · ${formatClinicalNumber(dilution.amount)} ${dilution.amountUnit} en ${formatClinicalNumber(dilution.volumeMl)} mL`;

const buildEquivalents = (
  amountPerHour: number,
  unit: DoseUnitId,
  dose: number,
  weightKg: number | null
): string[] => {
  const definition = DOSE_UNITS[unit];
  const equivalents = [`${formatClinicalNumber(amountPerHour)} ${definition.amount}/h en total`];
  if (definition.perMinute) {
    equivalents.push(
      `${formatClinicalNumber(amountPerHour / 60)} ${definition.amount}/min en total`
    );
  }
  if (!definition.perKg && weightKg) {
    const perKg = dose / weightKg;
    const suffix = definition.perMinute ? 'min' : 'h';
    equivalents.push(`${formatClinicalNumber(perKg)} ${definition.amount}/kg/${suffix}`);
  }
  return equivalents;
};

const buildRangeNotice = (
  preset: InfusionPreset | null,
  dose: number,
  unit: DoseUnitId,
  weightKg: number | null
): InfusionRangeNotice | null => {
  if (!preset) return null;
  const range = preset.usualRange;
  const assessment = assessDoseAgainstRange(dose, unit, range, weightKg);
  if (assessment === 'unknown') return null;
  const bounds = `${formatClinicalNumber(range.min)}–${formatClinicalNumber(range.max)} ${range.unit}`;
  const label =
    assessment === 'within'
      ? `Dentro del rango habitual (${bounds})`
      : assessment === 'below'
        ? `Bajo el rango habitual (${bounds})`
        : `Sobre el rango habitual (${bounds}): verificar la indicación`;
  return { assessment, label, note: range.note };
};

export const presentInfusion = (input: InfusionPresentationInput): InfusionPresentation => {
  const { mode, unit, weightKg, dilution, preset } = input;
  const sourceText = mode === 'dose' ? input.doseText : input.rateText;
  if (sourceText.trim() === '') {
    return {
      kind: 'idle',
      message:
        mode === 'dose'
          ? 'Ingresa la dosis para calcular la velocidad de la bomba.'
          : 'Ingresa la velocidad en mL/h para calcular la dosis.',
    };
  }
  const sourceValue = parseLocalizedDecimal(sourceText);
  if (sourceValue === null) {
    return {
      kind: 'error',
      message: FAILURE_MESSAGES[mode === 'dose' ? 'invalid_dose' : 'invalid_rate'],
    };
  }
  if (!dilution) return { kind: 'error', message: FAILURE_MESSAGES.invalid_dilution };

  if (mode === 'dose') {
    const result = computeRateFromDose({ dose: sourceValue, unit, weightKg, dilution });
    if (!result.ok) return { kind: 'error', message: FAILURE_MESSAGES[result.reason] };
    return {
      kind: 'result',
      primaryValue: formatRate(result.value.rateMlPerHour),
      primaryUnit: 'mL/h',
      concentrationLabel: concentrationLabel(result.value.concentration, dilution),
      equivalents: buildEquivalents(result.value.amountPerHour, unit, sourceValue, weightKg),
      range: buildRangeNotice(preset, sourceValue, unit, weightKg),
    };
  }

  const result = computeDoseFromRate({ rateMlPerHour: sourceValue, unit, weightKg, dilution });
  if (!result.ok) return { kind: 'error', message: FAILURE_MESSAGES[result.reason] };
  return {
    kind: 'result',
    primaryValue: formatClinicalNumber(result.value.dose),
    primaryUnit: unit,
    concentrationLabel: concentrationLabel(result.value.concentration, dilution),
    equivalents: buildEquivalents(result.value.amountPerHour, unit, result.value.dose, weightKg),
    range: buildRangeNotice(preset, result.value.dose, unit, weightKg),
  };
};
