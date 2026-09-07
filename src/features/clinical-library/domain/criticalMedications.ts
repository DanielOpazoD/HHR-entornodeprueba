import type { CriticalMedication, CriticalMedicationPresentation } from './criticalMedicationTypes';

/**
 * Hoja rápida de preparación de medicamentos críticos (adultos) del Servicio de
 * Hospitalizados. Transcripción estructurada de la hoja institucional; los textos
 * son los de la hoja y se muestran tal cual en pantalla y en la impresión.
 */

export * from './criticalMedicationTypes';

export const CRITICAL_MEDICATIONS_SHEET = {
  title: 'Hoja rápida de preparación de medicamentos críticos',
  subtitle: 'Adultos · Hospital Hanga Roa · Servicio de Hospitalizados',
  scope: 'Preparación IV, vía, bolo y dosis habitual',
  headerNotes: [
    'VVP para vasoactivos: inicio o puente; vena proximal de buen calibre, línea exclusiva, sitio visible y control frecuente. No retrasar un vasopresor por esperar CVC.',
    'Cambio de fármaco o concentración: doble chequeo y considerar volumen muerto. No lavar ni bolusar una línea con catecolaminas; preferir lumen nuevo o manejar según volumen interno del sistema.',
  ],
  legend:
    'Sí = permitido · Cond. = condiciones señaladas · No = no usar · BIC = bomba de infusión continua · SF = NaCl 0,9 % · SG5 % = glucosa 5 % · Todas las mezclas: completar al volumen final indicado.',
  formulas: [
    'mcg/kg/min: mL/h = dosis × peso × 60 / concentración (mcg/mL)',
    'mg/kg/h: mL/h = dosis × peso / concentración (mg/mL)',
    'mcg/min: mL/h = dosis × 60 / concentración (mcg/mL)',
  ],
  alerts: [
    'KCl nunca IV directo.',
    'Rocuronio no aporta sedación ni analgesia.',
    'Bicarbonato: no compartir línea con calcio ni catecolaminas.',
    'Concentraciones CVC altas: rotular y doble chequeo.',
    'Amiodarona: SG5 % y filtro.',
    'NaCl 3 % por VVP sólo en infusión corta por vena proximal vigilada.',
    'Vasoactivos, propofol y NTG: línea identificada y exclusiva; NTG con tubuladura de baja adsorción.',
    'Dobutamina y dopamina: presentaciones locales informadas; confirmar rótulo antes de preparar.',
  ],
  sources: 'SCCM 2026, AHA 2025, ASHP S4S 2026 y fichas técnicas vigentes.',
} as const;

export { CRITICAL_MEDICATIONS } from './criticalMedicationEntries';

export type AmpouleVariant = 'amp5' | 'amp10';

export const presentationFor = (
  medication: CriticalMedication,
  variant: AmpouleVariant
): CriticalMedicationPresentation =>
  medication.presentations.find(item => item.variant === variant) ?? medication.presentations[0];
