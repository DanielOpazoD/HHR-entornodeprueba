export type PatientRowAction =
  | 'clear'
  | 'copy'
  | 'move'
  | 'discharge'
  | 'transfer'
  | 'cma'
  /** «Paciente no válido»: an Eloísa episode created by mistake, removed for good. */
  | 'invalid';

export type UtilityPatientRowAction = Extract<PatientRowAction, 'clear' | 'copy' | 'move'>;
export type ClinicalPatientRowAction = Extract<PatientRowAction, 'discharge' | 'transfer' | 'cma'>;
