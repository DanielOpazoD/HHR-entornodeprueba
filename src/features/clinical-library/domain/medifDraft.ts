import {
  MEDIF_FIELDS,
  MEDIF_FIELD_BY_ID,
  MEDIF_GROUPS,
  MEDIF_IDENTITY_ALIASES,
  MEDIF_FIELD_ALIASES,
  MEDIF_PHYSICIAN_ALIASES,
  isMedifFieldId,
  type MedifValues,
} from './medifSchema';
import { emptyMedifPreferences, filterMedifExportValues } from './medifPreferences';
import type { MedifPreferences } from './medifPreferences';

export type { MedifValues } from './medifSchema';
export interface MedifDraft {
  version: 1;
  values: MedifValues;
}

export const emptyMedifValues = (): MedifValues =>
  Object.fromEntries(MEDIF_FIELDS.map(field => [field.id, '']));

export const setMedifFieldValue = (
  values: MedifValues,
  fieldId: string,
  value: string
): MedifValues => {
  if (!isMedifFieldId(fieldId)) throw new Error('El campo MEDIF no existe.');
  if (MEDIF_FIELD_BY_ID[fieldId].kind === 'mark' && value !== '' && value !== 'X') {
    throw new Error('Los casilleros MEDIF solo admiten X o una respuesta vacía.');
  }
  const next = { ...values, [fieldId]: value };
  const aliases = MEDIF_FIELD_ALIASES.find(ids => ids.includes(fieldId));
  for (const alias of aliases ?? []) next[alias] = value;
  if (value === 'X') {
    const group = MEDIF_GROUPS.find(
      candidate =>
        candidate.type === 'choice' &&
        !candidate.multiple &&
        candidate.options.some(option => option.fieldId === fieldId)
    );
    if (group?.type === 'choice') {
      for (const option of group.options)
        next[option.fieldId] = option.fieldId === fieldId ? 'X' : '';
    }
  }
  return next;
};

/** Reject conflicting imported answers instead of silently choosing a clinical response. */
export const validateMedifValues = (value: unknown): MedifValues => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El borrador MEDIF no contiene valores válidos.');
  }
  const values = value as Record<string, unknown>;
  const result = emptyMedifValues();
  for (const [fieldId, fieldValue] of Object.entries(values)) {
    if (!isMedifFieldId(fieldId) || typeof fieldValue !== 'string') {
      throw new Error('El borrador contiene campos desconocidos o valores que no son texto.');
    }
    if (MEDIF_FIELD_BY_ID[fieldId].kind === 'mark' && fieldValue !== '' && fieldValue !== 'X') {
      throw new Error('Los casilleros MEDIF solo admiten X o una respuesta vacía.');
    }
    result[fieldId] = fieldValue;
  }
  for (const group of MEDIF_GROUPS) {
    if (
      group.type === 'choice' &&
      !group.multiple &&
      group.options.filter(option => result[option.fieldId] === 'X').length > 1
    ) {
      throw new Error(`El borrador contiene respuestas incompatibles en «${group.label}».`);
    }
  }
  for (const aliases of MEDIF_IDENTITY_ALIASES) {
    if (aliases.some(id => result[id] !== result[aliases[0]])) {
      throw new Error('El nombre o la edad no coinciden entre las dos partes del formulario.');
    }
  }
  // Legacy drafts may contain just one physician name. Datos del médico is authoritative.
  const [physicianId] = MEDIF_PHYSICIAN_ALIASES;
  const physicianNames = [
    ...new Set(MEDIF_PHYSICIAN_ALIASES.map(id => result[id]).filter(name => name.trim())),
  ];
  if (!result[physicianId].trim() && physicianNames.length > 1) {
    throw new Error(
      'El borrador contiene nombres de médico diferentes. Revisa los datos del médico.'
    );
  }
  const physicianName = result[physicianId].trim()
    ? result[physicianId]
    : (physicianNames[0] ?? '');
  for (const id of MEDIF_PHYSICIAN_ALIASES) result[id] = physicianName;
  return result;
};

export const importMedifDraft = (json: string): MedifValues => {
  if (json.length > 2_000_000) throw new Error('El archivo de borrador MEDIF es demasiado grande.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('El archivo de borrador MEDIF no es un JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('El archivo no contiene un borrador MEDIF válido.');
  }
  const draft = parsed as Record<string, unknown>;
  if (
    draft.version !== 1 ||
    Object.keys(draft).some(key => key !== 'version' && key !== 'values')
  ) {
    throw new Error('El borrador MEDIF debe tener versión 1 y contener únicamente sus valores.');
  }
  return validateMedifValues(draft.values);
};

/** Download-only serialization: this module never writes patient information to browser storage. */
export const exportMedifDraft = (
  values: MedifValues,
  preferences: MedifPreferences = emptyMedifPreferences()
): string =>
  JSON.stringify(
    { version: 1, values: filterMedifExportValues(validateMedifValues(values), preferences) },
    null,
    2
  );
