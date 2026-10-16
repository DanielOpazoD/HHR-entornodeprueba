import { describe, expect, it, vi } from 'vitest';
import {
  MEDIF_PREFERENCES_STORAGE_KEY,
  emptyMedifPreferences,
  defaultMedifPreferences,
  exportMedifPreferences,
  filterMedifExportValues,
  importMedifPreferences,
  loadMedifPreferences,
  saveMedifPreferences,
  setMedifFieldHidden,
  toggleHiddenMedifField,
} from '@/features/clinical-library/domain/medifPreferences';
import {
  emptyMedifValues,
  exportMedifDraft,
  importMedifDraft,
  setMedifFieldValue,
} from '@/features/clinical-library/domain/medifDraft';

import { MEDIF_FIELDS } from '@/features/clinical-library/domain/medifSchema';
import { MEDIF_DEFAULT_HIDDEN_SELECTION } from '@/features/clinical-library/domain/medifDefaultHiddenFields';

const configuration = (hiddenFieldIds: unknown[], version = 1) =>
  JSON.stringify({ version, hiddenFieldIds });

const memoryStorage = (initial: string | null = null) => {
  let saved = initial;
  return {
    getItem: vi.fn(() => saved),
    setItem: vi.fn((_key: string, value: string) => {
      saved = value;
    }),
  };
};

describe('MEDIF field preferences', () => {
  it('hides and restores all three physician copies as one value', () => {
    for (const id of ['p2_nombre_medico', 'p1_medico_autorizado', 'p3_medico_declaracion']) {
      const hidden = setMedifFieldHidden(emptyMedifPreferences(), id, true);
      expect(hidden.hiddenFieldIds).toEqual([
        'p1_medico_autorizado',
        'p2_nombre_medico',
        'p3_medico_declaracion',
      ]);
      expect(setMedifFieldHidden(hidden, 'p2_nombre_medico', false)).toEqual(
        emptyMedifPreferences()
      );
      expect(importMedifPreferences(configuration([id]))).toEqual(hidden);
    }
  });
  it('keeps the all-visible option and applies hiding to whole questions and repeated identity', () => {
    const original = emptyMedifPreferences();
    expect(original.hiddenFieldIds).toEqual([]);
    const wheelchair = setMedifFieldHidden(original, 'p1_silla_si', true);
    expect(wheelchair.hiddenFieldIds).toEqual(['p1_silla_si', 'p1_silla_no']);
    expect(original.hiddenFieldIds).toEqual([]);
    expect(toggleHiddenMedifField(wheelchair, 'p1_silla_no').hiddenFieldIds).toEqual([]);
    const identity = setMedifFieldHidden(original, 'p2_nombre_paciente', true);
    expect(identity.hiddenFieldIds).toEqual(['p1_nombre_pasajero', 'p2_nombre_paciente']);
    expect(importMedifPreferences(configuration(['p1_edad'])).hiddenFieldIds).toEqual([
      'p1_edad',
      'p2_edad',
    ]);
  });

  it('uses exactly the 44 selected variables plus the two complementary answers as the initial preset', () => {
    const preferences = defaultMedifPreferences();
    expect(MEDIF_DEFAULT_HIDDEN_SELECTION).toHaveLength(44);
    expect(new Set(MEDIF_DEFAULT_HIDDEN_SELECTION).size).toBe(44);
    expect(preferences.version).toBe(2);
    expect(preferences.hiddenFieldIds).toHaveLength(46);
    expect(preferences.hiddenFieldIds).toEqual(
      expect.arrayContaining([...MEDIF_DEFAULT_HIDDEN_SELECTION])
    );
    expect(
      preferences.hiddenFieldIds.filter(id => !MEDIF_DEFAULT_HIDDEN_SELECTION.includes(id))
    ).toEqual(['p2_instrucciones_si', 'p2_estable_si']);
    expect(
      MEDIF_FIELDS.filter(field => !preferences.hiddenFieldIds.includes(field.id))
    ).toHaveLength(91);
    expect(loadMedifPreferences(memoryStorage())).toEqual(preferences);
    preferences.hiddenFieldIds.length = 0;
    expect(defaultMedifPreferences().hiddenFieldIds).toHaveLength(46);
  });

  it('migrates legacy browser preferences once, retaining additional hidden fields', () => {
    const storage = memoryStorage(configuration(['p1_edad']));
    const preferences = loadMedifPreferences(storage);
    expect(preferences.hiddenFieldIds).toEqual(
      expect.arrayContaining(defaultMedifPreferences().hiddenFieldIds)
    );
    expect(preferences.hiddenFieldIds).toHaveLength(48);
    expect(preferences.hiddenFieldIds).toContain('p1_edad');
    expect(preferences.hiddenFieldIds).toContain('p2_edad');
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      MEDIF_PREFERENCES_STORAGE_KEY,
      exportMedifPreferences(preferences)
    );
    expect(loadMedifPreferences(storage)).toEqual(preferences);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('deduplicates migration even when the legacy configuration already hides every field', () => {
    const storage = memoryStorage(configuration(MEDIF_FIELDS.map(field => field.id)));
    expect(loadMedifPreferences(storage).hiddenFieldIds).toHaveLength(137);
    expect(JSON.parse(storage.getItem()!).version).toBe(2);
  });

  it('keeps the migrated selection in the session when writing browser storage fails', () => {
    const storage = {
      getItem: () => configuration(['p1_edad']),
      setItem: () => {
        throw new Error('Storage blocked');
      },
    };
    const preferences = loadMedifPreferences(storage);
    expect(preferences.hiddenFieldIds).toHaveLength(48);
    expect(preferences.hiddenFieldIds).toContain('p1_edad');
    expect(preferences.hiddenFieldIds).toContain('p2_edad');
  });

  it('preserves restored fields and the all-visible option across reloads', () => {
    const storage = memoryStorage();
    let preferences = setMedifFieldHidden(defaultMedifPreferences(), 'p1_seguro_viaje', false);
    preferences = setMedifFieldHidden(preferences, 'p2_estable_no', false);
    expect(saveMedifPreferences(preferences, storage)).toBe(true);
    expect(loadMedifPreferences(storage)).toEqual(preferences);
    expect(loadMedifPreferences(storage).hiddenFieldIds).not.toContain('p1_seguro_viaje');
    expect(loadMedifPreferences(storage).hiddenFieldIds).not.toContain('p2_estable_si');
    expect(loadMedifPreferences(storage).hiddenFieldIds).not.toContain('p2_estable_no');
    expect(saveMedifPreferences(emptyMedifPreferences(), storage)).toBe(true);
    expect(loadMedifPreferences(storage)).toEqual({ version: 2, hiddenFieldIds: [] });
  });

  it('imports version 1 or 2 explicitly without adding the initial preset and exports version 2', () => {
    for (const version of [1, 2]) {
      const preferences = importMedifPreferences(configuration(['p1_edad'], version));
      expect(preferences).toEqual({ version: 2, hiddenFieldIds: ['p1_edad', 'p2_edad'] });
      expect(importMedifPreferences(exportMedifPreferences(preferences))).toEqual(preferences);
      expect(importMedifPreferences(configuration([], version))).toEqual(emptyMedifPreferences());
      const storage = memoryStorage();
      saveMedifPreferences(preferences, storage);
      expect(loadMedifPreferences(storage)).toEqual(preferences);
    }
  });

  it('exports only visible fields without erasing hidden session values', () => {
    let values = setMedifFieldValue(emptyMedifValues(), 'p1_nombre_pasajero', 'Paciente Sintético');
    values = setMedifFieldValue(values, 'p1_silla_si', 'X');
    const preferences = setMedifFieldHidden(emptyMedifPreferences(), 'p1_nombre_pasajero', true);
    const filtered = filterMedifExportValues(values, preferences);
    expect(filtered).not.toHaveProperty('p1_nombre_pasajero');
    expect(filtered).not.toHaveProperty('p2_nombre_paciente');
    expect(filtered.p1_silla_si).toBe('X');
    expect(values.p1_nombre_pasajero).toBe('Paciente Sintético');
    expect(exportMedifDraft(values, preferences)).not.toContain('Paciente Sintético');
    expect(importMedifDraft(exportMedifDraft(values, preferences)).p1_nombre_pasajero).toBe('');
    const visible = setMedifFieldHidden(preferences, 'p2_nombre_paciente', false);
    expect(filterMedifExportValues(values, visible).p1_nombre_pasajero).toBe('Paciente Sintético');
  });

  it('stores and exports only versioned known field identifiers', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    const preferences = setMedifFieldHidden(emptyMedifPreferences(), 'p1_edad', true);
    expect(saveMedifPreferences(preferences, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      MEDIF_PREFERENCES_STORAGE_KEY,
      exportMedifPreferences(preferences)
    );
    storage.getItem.mockReturnValue(exportMedifPreferences(preferences));
    expect(loadMedifPreferences(storage)).toEqual(preferences);
    expect(JSON.parse(exportMedifPreferences(preferences))).toEqual({
      version: 2,
      hiddenFieldIds: ['p1_edad', 'p2_edad'],
    });
    expect(() => importMedifPreferences(configuration(['patientName']))).toThrow(/conocidos/);
    expect(() => importMedifPreferences(configuration([12]))).toThrow(/conocidos/);
    expect(() =>
      importMedifPreferences(JSON.stringify({ ...preferences, patient: 'Ana' }))
    ).toThrow(/solo identificadores/);
    expect(() =>
      importMedifPreferences(JSON.stringify({ version: 3, hiddenFieldIds: [] }))
    ).toThrow(/versión 1 o 2/);
  });

  it('survives corrupt or blocked local storage and reports save failure', () => {
    const corrupt = { getItem: () => '{', setItem: vi.fn() };
    expect(loadMedifPreferences(corrupt)).toEqual(defaultMedifPreferences());
    const blocked = {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    };
    expect(loadMedifPreferences(blocked)).toEqual(defaultMedifPreferences());
    expect(saveMedifPreferences(emptyMedifPreferences(), blocked)).toBe(false);
  });
});
