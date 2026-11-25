import type { ClinicalFormValues } from './clinicalFormTypes';

export const SIC_FORM_ID = 'solicitud-interconsulta-hhr';
export const SIC_STRUCTURED_NAME_IDS = [
  'paciente_apellido_paterno',
  'paciente_apellido_materno',
  'paciente_nombres',
] as const;

export const hasSicStructuredName = (input: ClinicalFormValues): boolean =>
  SIC_STRUCTURED_NAME_IDS.some(id => Boolean(String(input[id] ?? '').trim()));

/** Never guess surnames from a free name, or print the full name over structured names. */
export const projectSicNames = (input: ClinicalFormValues): ClinicalFormValues => ({
  ...input,
  paciente_nombre_completo: hasSicStructuredName(input)
    ? null
    : (input.paciente_nombre_completo ?? null),
});
