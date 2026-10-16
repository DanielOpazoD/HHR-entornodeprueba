import { emptyMedifValues, setMedifFieldValue } from '../medifDraft';
import { parseFormDate, formatFormDate } from './clinicalFormDates';
import type { ClinicalFormPatientOption } from './clinicalFormTypes';

/** Adapt the shared facts without turning MEDIF's habitual answers into census facts. */
export const medifValuesFromClinicalPatient = (patient: ClinicalFormPatientOption) => {
  let values = emptyMedifValues();
  const pairs: Array<[string, string]> = [
    ['paciente_nombre_completo', 'p1_nombre_pasajero'],
    ['paciente_edad_texto', 'p1_edad'],
    ['diagnostico_texto', 'p2_diagnostico_actual'],
    ['paciente_sexo_biologico', 'p2_genero'],
    ['medico_tratante_nombre', 'p2_nombre_medico'],
  ];
  for (const [id, target] of pairs) {
    const value = patient.values[id];
    if (typeof value === 'string') values = setMedifFieldValue(values, target, value);
  }
  const admission = patient.values.ingreso_fecha;
  const census = parseFormDate(patient.context.recordDate);
  const date = typeof admission === 'string' ? parseFormDate(admission) : null;
  // Existing, explicitly requested MEDIF-only exception; not a symptom-onset variable.
  if (typeof admission === 'string' && date && census && date.timestamp <= census.timestamp) {
    values = setMedifFieldValue(values, 'p2_contagiosa_fecha_tipo', formatFormDate(admission));
  }
  return values;
};
