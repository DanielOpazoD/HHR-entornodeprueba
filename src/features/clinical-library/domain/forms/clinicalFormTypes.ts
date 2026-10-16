export const CLINICAL_FORM_IDS = [
  'solicitud-laboratorio-policlinico',
  'solicitud-imagenologia',
  'encuesta-contraste',
  'consentimiento-informado',
  'solicitud-tuberculosis',
  'solicitud-vdrl-mha-tp',
  'solicitud-serologia-hepatitis-chagas',
  'planilla-monitorizacion-ventilatoria',
  'informe-traslado-hospital-salvador',
] as const;

export type ClinicalFormId = (typeof CLINICAL_FORM_IDS)[number];
export type ClinicalFormValue = string | boolean | null;
export type ClinicalFormValues = Record<string, ClinicalFormValue>;

export interface ClinicalFormTarget {
  /** Zero based page; rectangle in PDF points, measured from the top left. */
  page: number;
  rect: [number, number, number, number];
  equals?: string | boolean;
  format?: 'date_dmy' | 'date_day' | 'date_month' | 'date_year' | 'sex_initial';
  fontSize?: number;
  align?: 'left' | 'center';
}

export interface ClinicalFormField {
  /** Canonical variable ID, or a form-specific ID. One control, several print targets. */
  id: string;
  label: string;
  section: string;
  kind: 'text' | 'date' | 'time' | 'boolean' | 'choice' | 'check';
  multiline?: boolean;
  options?: Array<{ value: string; label: string }>;
  targets: ClinicalFormTarget[];
  /** Matrix coordinates for the VMI observation grid. No calculated clinical values. */
  row?: number;
  column?: string;
}

export interface ClinicalFormDefinition {
  id: ClinicalFormId;
  title: string;
  revision: number;
  catalogVersion: string;
  templateUrl: string;
  sourceUrl: string;
  templateSha256: string;
  sourceSha256: string;
  pages: Array<{ width: number; height: number }>;
  fields: ClinicalFormField[];
}

export interface ClinicalFormProvenance {
  source: 'hhr';
  sourcePath: string;
  recordDate: string;
  sourceLastUpdated: string;
  transformation: string;
}

export interface ClinicalFormPatientOption {
  key: string;
  label: string;
  values: ClinicalFormValues;
  provenance: Record<string, ClinicalFormProvenance>;
  context: {
    recordDate: string;
    bedId: string;
    location: 'bed' | 'clinicalCrib';
    episodeId: string;
    identity: string;
    sourceLastUpdated: string;
  };
}

export const isClinicalFormId = (id: string): id is ClinicalFormId =>
  CLINICAL_FORM_IDS.some(candidate => candidate === id);
