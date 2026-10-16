import { describe, expect, it } from 'vitest';
import {
  emptyMedifValues,
  setMedifFieldValue,
  validateMedifValues,
} from '@/features/clinical-library/domain/medifDraft';
import { applyMedifHabitualAnswers } from '@/features/clinical-library/domain/medifHabitualAnswers';
import {
  defaultMedifPreferences,
  setMedifFieldHidden,
} from '@/features/clinical-library/domain/medifPreferences';

const requestedMarks = [
  'p1_especiales_no',
  'p2_instrucciones_si',
  'p1_silla_no',
  'p3_silla_ruedas_no',
  'p3_patologia_psiquiatrica_no',
  'p3_flectar_rodillas_si',
  'p3_flectar_cadera_si',
  'p2_medicacion_previa_no',
  'p2_medicacion_durante_no',
  'p2_anticoagulante_no',
  'p1_coord_ambulancia_no',
  'p2_hospitalizacion_si',
  'p2_hospitalizacion_destino_si',
  'p2_comer_si',
  'p2_bano_si',
  'p2_conducta_no',
  'p2_esfinter_no',
  'p2_riesgo_bajo',
  'p2_condiciones_volar_si',
  'p2_contagiosa_no',
];

describe('MEDIF habitual answers action', () => {
  it('fills exactly the requested 20 choices and route without adding other answers', () => {
    const original = emptyMedifValues();
    const result = applyMedifHabitualAnswers(original, defaultMedifPreferences());
    expect(result.applied).toBe(22);
    expect(Object.fromEntries(Object.entries(result.values).filter(([, value]) => value))).toEqual({
      ...Object.fromEntries(requestedMarks.map(id => [id, 'X'])),
      p1_itinerario_1_desde: 'Isla de pascua',
      p1_itinerario_1_hacia: 'Santiago',
    });
    expect(validateMedifValues(result.values)).toEqual(result.values);
    expect(Object.values(original).every(value => !value)).toBe(true);
    expect(applyMedifHabitualAnswers(result.values, defaultMedifPreferences())).toEqual({
      values: result.values,
      applied: 0,
    });
  });

  it('preserves existing alternatives, risk, manual destinations and unrelated fields', () => {
    let values = setMedifFieldValue(emptyMedifValues(), 'p1_silla_si', 'X');
    values = setMedifFieldValue(values, 'p2_medicacion_previa_si', 'X');
    values = setMedifFieldValue(values, 'p2_riesgo_alto', 'X');
    values = setMedifFieldValue(values, 'p1_itinerario_1_hacia', 'Valparaíso');
    values = setMedifFieldValue(values, 'p2_nombre_medico', 'Dra. Prueba');
    values = setMedifFieldValue(values, 'p1_especiales_si', 'X');
    values = setMedifFieldValue(values, 'p2_instrucciones_no', 'X');
    const original = { ...values };
    const result = applyMedifHabitualAnswers(values, defaultMedifPreferences());
    expect(result.applied).toBe(16);
    for (const [id, value] of Object.entries(original).filter(([, value]) => value)) {
      expect(result.values[id], id).toBe(value);
    }
    for (const id of [
      'p1_silla_no',
      'p2_medicacion_previa_no',
      'p2_riesgo_bajo',
      'p1_especiales_no',
      'p2_instrucciones_si',
    ]) {
      expect(result.values[id]).toBe('');
    }
    expect(result.values.p3_silla_ruedas_no).toBe('X');
    expect(result.values.p1_itinerario_1_desde).toBe('Isla de pascua');
    expect(values).toEqual(original);
  });

  it('skips hidden questions and text without changing their stored values or preferences', () => {
    let preferences = setMedifFieldHidden(defaultMedifPreferences(), 'p2_hospitalizacion_si', true);
    preferences = setMedifFieldHidden(preferences, 'p1_itinerario_1_hacia', true);
    const before = structuredClone(preferences);
    const values = setMedifFieldValue(emptyMedifValues(), 'p1_itinerario_1_hacia', 'Oculto');
    const result = applyMedifHabitualAnswers(values, preferences);
    expect(result.values.p2_hospitalizacion_si).toBe('');
    expect(result.values.p2_hospitalizacion_no).toBe('');
    expect(result.values.p1_itinerario_1_hacia).toBe('Oculto');
    expect(result.values.p2_hospitalizacion_destino_si).toBe('X');
    expect(preferences).toEqual(before);
  });
});
