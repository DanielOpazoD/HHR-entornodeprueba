/** Tipos y etiquetas de la hoja rápida de medicamentos críticos. */

export type RouteAllowance = 'si' | 'cond' | 'no';

export interface CriticalMedicationPreparation {
  /** Etiqueta de la vía o escenario: «VVP», «CVC alta», «Baja», «Carga», etc. */
  label?: string;
  text: string;
  /** Concentración final destacada, p. ej. «32 mcg/mL». */
  concentration?: string;
}

export interface CriticalMedicationPresentation {
  /** Identificador del variante local, p. ej. ampolla de 5 o 10 mL. */
  variant?: 'amp5' | 'amp10';
  text: string;
  preparations: ReadonlyArray<CriticalMedicationPreparation>;
}

export interface CriticalMedication {
  id: string;
  name: string;
  group: 'vasoactivo' | 'sedoanalgesia' | 'electrolitos' | 'otros';
  presentations: ReadonlyArray<CriticalMedicationPresentation>;
  vvp: RouteAllowance;
  vvpNote?: string;
  cvc: RouteAllowance;
  bolus: RouteAllowance;
  bolusText?: string;
  dose: string;
}

export const ROUTE_ALLOWANCE_LABELS: Readonly<Record<RouteAllowance, string>> = {
  si: 'Sí',
  cond: 'Cond.',
  no: 'No',
};

export const CRITICAL_MEDICATION_GROUP_LABELS: Readonly<
  Record<CriticalMedication['group'], string>
> = {
  vasoactivo: 'Vasoactivos e inótropos',
  sedoanalgesia: 'Sedación, analgesia y bloqueo',
  electrolitos: 'Electrolitos y corrección ácido-base',
  otros: 'Otros',
};
