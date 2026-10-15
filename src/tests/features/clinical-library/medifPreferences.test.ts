import { describe, expect, it, vi } from 'vitest';
import {
  MEDIF_PREFERENCES_STORAGE_KEY,
  emptyMedifPreferences,
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

const configuration = (hiddenFieldIds: unknown[]) => JSON.stringify({ version: 1, hiddenFieldIds });

describe('MEDIF field preferences', () => {
  it('shows every field by default and applies hiding to whole questions and repeated identity', () => {
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
      version: 1,
      hiddenFieldIds: ['p1_edad', 'p2_edad'],
    });
    expect(() => importMedifPreferences(configuration(['patientName']))).toThrow(/conocidos/);
    expect(() => importMedifPreferences(configuration([12]))).toThrow(/conocidos/);
    expect(() =>
      importMedifPreferences(JSON.stringify({ ...preferences, patient: 'Ana' }))
    ).toThrow(/solo identificadores/);
    expect(() =>
      importMedifPreferences(JSON.stringify({ version: 2, hiddenFieldIds: [] }))
    ).toThrow(/versión 1/);
  });

  it('survives corrupt or blocked local storage and reports save failure', () => {
    const corrupt = { getItem: () => '{', setItem: vi.fn() };
    expect(loadMedifPreferences(corrupt)).toEqual(emptyMedifPreferences());
    const blocked = {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    };
    expect(loadMedifPreferences(blocked)).toEqual(emptyMedifPreferences());
    expect(saveMedifPreferences(emptyMedifPreferences(), blocked)).toBe(false);
  });
});
