import type { ClinicalFormDefinition } from './clinicalFormTypes';

export interface ClinicalFormPreferences {
  kind: 'hhr-clinical-form-preferences';
  version: 1;
  formId: string;
  revision: number;
  hidden: string[];
}

export const emptyClinicalFormPreferences = (
  form: ClinicalFormDefinition
): ClinicalFormPreferences => ({
  kind: 'hhr-clinical-form-preferences',
  version: 1,
  formId: form.id,
  revision: form.revision,
  hidden: [],
});

export const parseClinicalFormPreferences = (
  text: string,
  form: ClinicalFormDefinition
): ClinicalFormPreferences => {
  if (text.length > 100_000) throw new Error('El archivo de preferencias es demasiado grande.');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('El archivo de preferencias no es un JSON válido.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Preferencias no válidas.');
  const data = input as Record<string, unknown>;
  if (
    data.kind !== 'hhr-clinical-form-preferences' ||
    data.version !== 1 ||
    data.formId !== form.id ||
    data.revision !== form.revision ||
    !Array.isArray(data.hidden) ||
    !data.hidden.every(id => typeof id === 'string' && form.fields.some(field => field.id === id))
  ) {
    throw new Error('Las preferencias no corresponden a esta versión del formulario.');
  }
  // Whitelist configuration only. Discard any extra properties or embedded patient values.
  return { ...emptyClinicalFormPreferences(form), hidden: [...new Set(data.hidden as string[])] };
};

const key = (form: ClinicalFormDefinition) =>
  `hhr:clinical-form-preferences:${form.id}:v${form.revision}`;

export const loadClinicalFormPreferences = (
  form: ClinicalFormDefinition
): ClinicalFormPreferences => {
  try {
    const saved = localStorage.getItem(key(form));
    return saved ? parseClinicalFormPreferences(saved, form) : emptyClinicalFormPreferences(form);
  } catch {
    return emptyClinicalFormPreferences(form);
  }
};

export const serializeClinicalFormPreferences = (preferences: ClinicalFormPreferences): string =>
  JSON.stringify(
    {
      kind: preferences.kind,
      version: preferences.version,
      formId: preferences.formId,
      revision: preferences.revision,
      hidden: [...preferences.hidden],
    },
    null,
    2
  );

export const saveClinicalFormPreferences = (
  form: ClinicalFormDefinition,
  preferences: ClinicalFormPreferences
): boolean => {
  try {
    localStorage.setItem(key(form), serializeClinicalFormPreferences(preferences));
    return true;
  } catch {
    return false;
  }
};
