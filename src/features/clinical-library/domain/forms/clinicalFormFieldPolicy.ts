import type { ClinicalFormField } from './clinicalFormTypes';

/** Clinical-record numbers are deliberately blank, regardless of saved preferences or drafts. */
export const isSuppressedClinicalFormField = (field: Pick<ClinicalFormField, 'id' | 'label'>) =>
  field.id === 'paciente_ficha_numero' ||
  /\bficha\b/i.test(field.label.normalize('NFD').replace(/\p{Diacritic}/gu, ''));

export const isSuppressedClinicalFormVariable = (id: string) => id === 'paciente_ficha_numero';
