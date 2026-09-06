/**
 * Diluciones de referencia para infusiones continuas frecuentes en UPC.
 *
 * Son valores de referencia habituales en la práctica chilena; cada preset
 * declara su rango de dosis usual para que la interfaz avise cuando el valor
 * ingresado queda fuera. No reemplazan el protocolo local ni la validación de
 * farmacia: la interfaz lo dice de forma explícita.
 */

import { convertDose, type DoseUnitId, type MassUnit } from './infusionCalculator';

export type InfusionPresetGroup = 'vasoactivo' | 'sedoanalgesia' | 'cardiovascular' | 'metabolico';

export const INFUSION_PRESET_GROUP_LABELS: Readonly<Record<InfusionPresetGroup, string>> = {
  vasoactivo: 'Vasoactivos e inótropos',
  sedoanalgesia: 'Sedación y analgesia',
  cardiovascular: 'Cardiovascular',
  metabolico: 'Metabólico y anticoagulación',
};

export interface InfusionPresetDilution {
  amount: number;
  amountUnit: MassUnit;
  volumeMl: number;
  /** Aclaración breve de la presentación, p. ej. «1 mg/mL» o «sin diluir». */
  hint?: string;
}

export interface InfusionDoseRange {
  min: number;
  max: number;
  unit: DoseUnitId;
  note?: string;
}

export interface InfusionPreset {
  id: string;
  name: string;
  group: InfusionPresetGroup;
  dilutions: ReadonlyArray<InfusionPresetDilution>;
  defaultUnit: DoseUnitId;
  allowedUnits: ReadonlyArray<DoseUnitId>;
  usualRange: InfusionDoseRange;
  notes: ReadonlyArray<string>;
}

const dilution = (
  amount: number,
  amountUnit: MassUnit,
  volumeMl: number,
  hint?: string
): InfusionPresetDilution => ({ amount, amountUnit, volumeMl, ...(hint ? { hint } : {}) });

export const INFUSION_PRESETS: ReadonlyArray<InfusionPreset> = [
  {
    id: 'noradrenalina',
    name: 'Noradrenalina',
    group: 'vasoactivo',
    dilutions: [dilution(4, 'mg', 250), dilution(8, 'mg', 250), dilution(16, 'mg', 250)],
    defaultUnit: 'mcg/kg/min',
    allowedUnits: ['mcg/kg/min', 'mcg/min'],
    usualRange: {
      min: 0.01,
      max: 0.5,
      unit: 'mcg/kg/min',
      note: 'En shock refractario se usan dosis mayores bajo vigilancia estrecha.',
    },
    notes: ['Preferir vía venosa central.', 'Titular según presión arterial media objetivo.'],
  },
  {
    id: 'adrenalina',
    name: 'Adrenalina',
    group: 'vasoactivo',
    dilutions: [dilution(4, 'mg', 250), dilution(8, 'mg', 250)],
    defaultUnit: 'mcg/kg/min',
    allowedUnits: ['mcg/kg/min', 'mcg/min'],
    usualRange: { min: 0.01, max: 0.5, unit: 'mcg/kg/min' },
    notes: ['Preferir vía venosa central.', 'Vigilar taquiarritmias y lactato.'],
  },
  {
    id: 'dopamina',
    name: 'Dopamina',
    group: 'vasoactivo',
    dilutions: [dilution(400, 'mg', 250), dilution(200, 'mg', 250)],
    defaultUnit: 'mcg/kg/min',
    allowedUnits: ['mcg/kg/min'],
    usualRange: { min: 2, max: 20, unit: 'mcg/kg/min' },
    notes: ['Efecto predominantemente beta entre 5 y 10 mcg/kg/min y alfa sobre 10 mcg/kg/min.'],
  },
  {
    id: 'dobutamina',
    name: 'Dobutamina',
    group: 'vasoactivo',
    dilutions: [dilution(250, 'mg', 250), dilution(500, 'mg', 250)],
    defaultUnit: 'mcg/kg/min',
    allowedUnits: ['mcg/kg/min'],
    usualRange: { min: 2, max: 20, unit: 'mcg/kg/min' },
    notes: ['Puede producir hipotensión por vasodilatación; corregir volemia antes de iniciar.'],
  },
  {
    id: 'milrinona',
    name: 'Milrinona',
    group: 'vasoactivo',
    dilutions: [dilution(20, 'mg', 100)],
    defaultUnit: 'mcg/kg/min',
    allowedUnits: ['mcg/kg/min'],
    usualRange: { min: 0.375, max: 0.75, unit: 'mcg/kg/min' },
    notes: ['Ajustar en insuficiencia renal.', 'Vigilar hipotensión y arritmias.'],
  },
  {
    id: 'vasopresina',
    name: 'Vasopresina',
    group: 'vasoactivo',
    dilutions: [dilution(20, 'UI', 100), dilution(40, 'UI', 100)],
    defaultUnit: 'UI/min',
    allowedUnits: ['UI/min', 'UI/h'],
    usualRange: {
      min: 0.01,
      max: 0.04,
      unit: 'UI/min',
      note: 'En shock séptico se usa habitualmente 0,03 UI/min como complemento de noradrenalina.',
    },
    notes: ['Dosis fija, no se titula por peso.', 'Vigilar isquemia digital y esplácnica.'],
  },
  {
    id: 'nitroglicerina',
    name: 'Nitroglicerina',
    group: 'cardiovascular',
    dilutions: [dilution(50, 'mg', 250), dilution(25, 'mg', 250)],
    defaultUnit: 'mcg/min',
    allowedUnits: ['mcg/min', 'mcg/kg/min'],
    usualRange: { min: 5, max: 200, unit: 'mcg/min' },
    notes: [
      'Iniciar bajo y titular cada 3 a 5 minutos.',
      'Usar bajadas compatibles según protocolo local.',
    ],
  },
  {
    id: 'nitroprusiato',
    name: 'Nitroprusiato',
    group: 'cardiovascular',
    dilutions: [dilution(50, 'mg', 250)],
    defaultUnit: 'mcg/kg/min',
    allowedUnits: ['mcg/kg/min'],
    usualRange: {
      min: 0.3,
      max: 3,
      unit: 'mcg/kg/min',
      note: 'Dosis de hasta 10 mcg/kg/min sólo por períodos breves.',
    },
    notes: [
      'Proteger de la luz.',
      'Vigilar toxicidad por cianuro en uso prolongado o insuficiencia renal.',
    ],
  },
  {
    id: 'labetalol',
    name: 'Labetalol',
    group: 'cardiovascular',
    dilutions: [dilution(200, 'mg', 200, '1 mg/mL')],
    defaultUnit: 'mg/min',
    allowedUnits: ['mg/min', 'mg/h'],
    usualRange: {
      min: 0.5,
      max: 2,
      unit: 'mg/min',
      note: 'Dosis acumulada máxima habitual 300 mg.',
    },
    notes: ['Contraindicado en asma, bradicardia y bloqueo AV avanzado.'],
  },
  {
    id: 'amiodarona',
    name: 'Amiodarona',
    group: 'cardiovascular',
    dilutions: [dilution(900, 'mg', 500), dilution(600, 'mg', 250)],
    defaultUnit: 'mg/min',
    allowedUnits: ['mg/min', 'mg/h'],
    usualRange: {
      min: 0.5,
      max: 1,
      unit: 'mg/min',
      note: 'Esquema habitual tras la carga: 1 mg/min por 6 h y luego 0,5 mg/min por 18 h.',
    },
    notes: [
      'Diluir en suero glucosado al 5 %.',
      'Concentraciones sobre 2 mg/mL (600 mg en 250 mL) sólo por vía venosa central.',
    ],
  },
  {
    id: 'midazolam',
    name: 'Midazolam',
    group: 'sedoanalgesia',
    dilutions: [dilution(100, 'mg', 100, '1 mg/mL'), dilution(50, 'mg', 50, '1 mg/mL')],
    defaultUnit: 'mg/kg/h',
    allowedUnits: ['mg/kg/h', 'mg/h'],
    usualRange: { min: 0.02, max: 0.2, unit: 'mg/kg/h' },
    notes: [
      'Acumulación en infusión prolongada, insuficiencia renal y hepática.',
      'Evaluar sedación con RASS.',
    ],
  },
  {
    id: 'fentanilo',
    name: 'Fentanilo',
    group: 'sedoanalgesia',
    dilutions: [
      dilution(1000, 'mcg', 100, '10 mcg/mL'),
      dilution(2500, 'mcg', 50, '50 mcg/mL sin diluir'),
    ],
    defaultUnit: 'mcg/kg/h',
    allowedUnits: ['mcg/kg/h', 'mcg/h'],
    usualRange: {
      min: 0.5,
      max: 5,
      unit: 'mcg/kg/h',
      note: 'En ventilación mecánica se usan dosis mayores según analgesia objetivo (guía PADIS 2018).',
    },
    notes: ['Vigilar depresión respiratoria y rigidez torácica con bolos rápidos.'],
  },
  {
    id: 'propofol',
    name: 'Propofol 1 %',
    group: 'sedoanalgesia',
    dilutions: [
      dilution(500, 'mg', 50, '10 mg/mL sin diluir'),
      dilution(1000, 'mg', 100, '10 mg/mL sin diluir'),
    ],
    defaultUnit: 'mg/kg/h',
    allowedUnits: ['mg/kg/h', 'mg/h'],
    usualRange: {
      min: 0.3,
      max: 3,
      unit: 'mg/kg/h',
      note: 'Evitar más de 4 mg/kg/h por más de 48 h (síndrome por infusión de propofol).',
    },
    notes: [
      'Aporta 1,1 kcal/mL de lípidos.',
      'Cambiar el sistema cada 12 h por riesgo de contaminación.',
    ],
  },
  {
    id: 'dexmedetomidina',
    name: 'Dexmedetomidina',
    group: 'sedoanalgesia',
    dilutions: [dilution(200, 'mcg', 50, '4 mcg/mL'), dilution(400, 'mcg', 100, '4 mcg/mL')],
    defaultUnit: 'mcg/kg/h',
    allowedUnits: ['mcg/kg/h', 'mcg/h'],
    usualRange: { min: 0.2, max: 1.4, unit: 'mcg/kg/h' },
    notes: ['Bradicardia e hipotensión, sobre todo con dosis de carga.'],
  },
  {
    id: 'insulina',
    name: 'Insulina cristalina',
    group: 'metabolico',
    dilutions: [dilution(100, 'UI', 100, '1 UI/mL'), dilution(50, 'UI', 50, '1 UI/mL')],
    defaultUnit: 'UI/h',
    allowedUnits: ['UI/h', 'UI/kg/h'],
    usualRange: {
      min: 1,
      max: 10,
      unit: 'UI/h',
      note: 'En cetoacidosis se usa 0,05 a 0,1 UI/kg/h con control horario de glicemia.',
    },
    notes: [
      'Purgar el sistema con la solución antes de conectar.',
      'Control de glicemia capilar horario al inicio.',
    ],
  },
  {
    id: 'heparina',
    name: 'Heparina no fraccionada',
    group: 'metabolico',
    dilutions: [dilution(25000, 'UI', 250, '100 UI/mL'), dilution(25000, 'UI', 500, '50 UI/mL')],
    defaultUnit: 'UI/kg/h',
    allowedUnits: ['UI/kg/h', 'UI/h'],
    usualRange: {
      min: 12,
      max: 18,
      unit: 'UI/kg/h',
      note: 'TEV: bolo 80 UI/kg + 18 UI/kg/h. Síndrome coronario agudo: bolo 60 UI/kg (máx. 4.000) + 12 UI/kg/h (máx. 1.000 UI/h).',
    },
    notes: [
      'Ajustar según TTPK o anti-Xa del protocolo local, con control a las 6 h de cada cambio de dosis.',
    ],
  },
];

export const findInfusionPreset = (id: string): InfusionPreset | undefined =>
  INFUSION_PRESETS.find(preset => preset.id === id);

export type DoseRangeAssessment = 'within' | 'below' | 'above' | 'unknown';

/** Compara una dosis con el rango habitual del preset, convirtiendo unidades si hace falta. */
export const assessDoseAgainstRange = (
  dose: number,
  unit: DoseUnitId,
  range: InfusionDoseRange,
  weightKg?: number | null
): DoseRangeAssessment => {
  const inRangeUnit = convertDose(dose, unit, range.unit, weightKg);
  if (inRangeUnit === null) return 'unknown';
  if (inRangeUnit < range.min) return 'below';
  if (inRangeUnit > range.max) return 'above';
  return 'within';
};
