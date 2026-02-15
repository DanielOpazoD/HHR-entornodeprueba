export type PatientRowAction = 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma';

export type UtilityPatientRowAction = Extract<PatientRowAction, 'clear' | 'copy' | 'move'>;
export type ClinicalPatientRowAction = Extract<PatientRowAction, 'discharge' | 'transfer' | 'cma'>;
