import {
  MEDIF_FIELDS,
  MEDIF_GROUPS,
  MEDIF_FIELD_ALIASES,
  getMedifGroupFieldIds,
  isMedifFieldId,
  type MedifValues,
} from './medifSchema';
import { MEDIF_DEFAULT_HIDDEN_SELECTION } from './medifDefaultHiddenFields';

export interface MedifPreferences {
  version: 2;
  hiddenFieldIds: string[];
}

export type MedifPreferencesStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const MEDIF_PREFERENCES_STORAGE_KEY = 'hhr.medif.preferences.v1';

export const emptyMedifPreferences = (): MedifPreferences => ({ version: 2, hiddenFieldIds: [] });

const getVisibilityUnit = (fieldId: string): readonly string[] => {
  if (!isMedifFieldId(fieldId))
    throw new Error('La configuración contiene un campo MEDIF desconocido.');
  const aliases = MEDIF_FIELD_ALIASES.find(ids => ids.includes(fieldId));
  if (aliases) return aliases;
  const choice = MEDIF_GROUPS.find(
    group => group.type === 'choice' && group.options.some(option => option.fieldId === fieldId)
  );
  return choice ? getMedifGroupFieldIds(choice) : [fieldId];
};

/** Hiding a response hides every alternative or copy of a shared value. */
const normalizeHiddenFieldIds = (fieldIds: string[]): string[] => {
  const hidden = new Set(fieldIds.flatMap(fieldId => [...getVisibilityUnit(fieldId)]));
  return MEDIF_FIELDS.filter(field => hidden.has(field.id)).map(field => field.id);
};

/** Initial visibility preset; each call returns independent, editable preferences. */
export const defaultMedifPreferences = (): MedifPreferences => ({
  version: 2,
  hiddenFieldIds: normalizeHiddenFieldIds([...MEDIF_DEFAULT_HIDDEN_SELECTION]),
});

/** Strict whitelist: preference files cannot smuggle patient values or unknown properties. */
export const validateMedifPreferences = (value: unknown): MedifPreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El archivo no contiene una configuración MEDIF válida.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(key => key !== 'version' && key !== 'hiddenFieldIds') ||
    (record.version !== 1 && record.version !== 2) ||
    !Array.isArray(record.hiddenFieldIds) ||
    record.hiddenFieldIds.length > MEDIF_FIELDS.length ||
    record.hiddenFieldIds.some(id => typeof id !== 'string' || !isMedifFieldId(id))
  ) {
    throw new Error(
      'La configuración MEDIF debe tener versión 1 o 2 y solo identificadores conocidos.'
    );
  }
  return { version: 2, hiddenFieldIds: normalizeHiddenFieldIds(record.hiddenFieldIds as string[]) };
};

const parseMedifPreferences = (json: string): unknown => {
  if (json.length > 50_000)
    throw new Error('El archivo de configuración MEDIF es demasiado grande.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('El archivo de configuración MEDIF no es un JSON válido.');
  }
  return parsed;
};

/** Explicit imports preserve the file's selection; version 1 does not imply the initial preset. */
export const importMedifPreferences = (json: string): MedifPreferences =>
  validateMedifPreferences(parseMedifPreferences(json));

export const exportMedifPreferences = (preferences: MedifPreferences): string =>
  JSON.stringify(validateMedifPreferences(preferences), null, 2);

const browserStorage = (): MedifPreferencesStorage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export const loadMedifPreferences = (
  storage: MedifPreferencesStorage | undefined = browserStorage()
): MedifPreferences => {
  try {
    const saved = storage?.getItem(MEDIF_PREFERENCES_STORAGE_KEY);
    if (!saved) return defaultMedifPreferences();
    const parsed = parseMedifPreferences(saved);
    const preferences = validateMedifPreferences(parsed);
    if ((parsed as { version: number }).version === 2) return preferences;
    // Apply the new preset once to legacy browser storage while keeping additional hidden IDs.
    const migrated: MedifPreferences = {
      version: 2,
      hiddenFieldIds: normalizeHiddenFieldIds([
        ...MEDIF_DEFAULT_HIDDEN_SELECTION,
        ...preferences.hiddenFieldIds,
      ]),
    };
    saveMedifPreferences(migrated, storage);
    return migrated;
  } catch {
    return defaultMedifPreferences();
  }
};

/** Persist IDs only. False reports unavailable/quota-limited storage without losing session state. */
export const saveMedifPreferences = (
  preferences: MedifPreferences,
  storage: MedifPreferencesStorage | undefined = browserStorage()
): boolean => {
  try {
    if (!storage) return false;
    storage.setItem(MEDIF_PREFERENCES_STORAGE_KEY, exportMedifPreferences(preferences));
    return true;
  } catch {
    return false;
  }
};

export const setMedifFieldHidden = (
  preferences: MedifPreferences,
  fieldId: string,
  hidden: boolean
): MedifPreferences => {
  const current = new Set(validateMedifPreferences(preferences).hiddenFieldIds);
  for (const id of getVisibilityUnit(fieldId)) {
    if (hidden) current.add(id);
    else current.delete(id);
  }
  return { version: 2, hiddenFieldIds: normalizeHiddenFieldIds([...current]) };
};

export const isMedifFieldHidden = (preferences: MedifPreferences, fieldId: string): boolean =>
  preferences.hiddenFieldIds.includes(fieldId);

export const toggleHiddenMedifField = (
  preferences: MedifPreferences,
  fieldId: string
): MedifPreferences =>
  setMedifFieldHidden(preferences, fieldId, !isMedifFieldHidden(preferences, fieldId));

/** Returns a new whitelist of visible values; the draft in memory is never modified. */
export const filterMedifExportValues = (
  values: MedifValues,
  preferences: MedifPreferences
): MedifValues => {
  const hidden = new Set(validateMedifPreferences(preferences).hiddenFieldIds);
  return Object.fromEntries(
    MEDIF_FIELDS.filter(field => !hidden.has(field.id)).map(field => [
      field.id,
      values[field.id] ?? '',
    ])
  );
};
