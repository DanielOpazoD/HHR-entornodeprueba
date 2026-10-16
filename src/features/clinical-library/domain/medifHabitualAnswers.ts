import { MEDIF_GROUPS, type MedifValues } from './medifSchema';
import { setMedifFieldValue } from './medifDraft';
import { isMedifFieldHidden, type MedifPreferences } from './medifPreferences';

/** Explicit MEDIF shortcuts requested by the user; applied only by the green check action. */
export const MEDIF_HABITUAL_MARK_IDS: readonly string[] = [
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

const HABITUAL_VALUES: Readonly<MedifValues> = {
  ...Object.fromEntries(MEDIF_HABITUAL_MARK_IDS.map(id => [id, 'X'])),
  p1_itinerario_1_desde: 'Isla de pascua',
  p1_itinerario_1_hacia: 'Santiago',
};

/** Preserve every existing answer, including the other alternatives in a choice question. */
export const applyMedifHabitualAnswers = (
  values: MedifValues,
  preferences: MedifPreferences
): { values: MedifValues; applied: number } => {
  let next = values;
  let applied = 0;
  for (const [id, value] of Object.entries(HABITUAL_VALUES)) {
    if (isMedifFieldHidden(preferences, id)) continue;
    const choice = MEDIF_GROUPS.find(
      group => group.type === 'choice' && group.options.some(option => option.fieldId === id)
    );
    const answered =
      choice?.type === 'choice'
        ? choice.options.some(option => values[option.fieldId]?.trim())
        : Boolean(values[id]?.trim());
    if (answered) continue;
    next = setMedifFieldValue(next, id, value);
    applied += 1;
  }
  return { values: next, applied };
};
