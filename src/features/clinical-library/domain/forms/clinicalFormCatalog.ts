import diat from './denuncia-accidente-trabajo-diat.json';
import interconsultation from './solicitud-interconsulta-hhr.json';
import imaging from './solicitud-imagenologia.json';
import contrast from './encuesta-contraste.json';
import consent from './consentimiento-informado.json';
import laboratory from './solicitud-laboratorio-policlinico.json';
import transfusion from './solicitud-transfusion-hemocomponentes.json';
import vdrl from './solicitud-vdrl-mha-tp.json';
import serology from './solicitud-serologia-hepatitis-chagas.json';
import tuberculosis from './solicitud-tuberculosis.json';
import braden from './pauta-braden-lpp.json';
import transfer from './informe-traslado-hospital-salvador.json';
import ventilation from './planilla-monitorizacion-ventilatoria.json';
import variables from './clinicalVariables.json';
import type { ClinicalFormDefinition, ClinicalFormId } from './clinicalFormTypes';

/** Loaded only when a form editor opens. Blank source assets stay outside the startup bundle. */
export const CLINICAL_FORMS: ReadonlyArray<ClinicalFormDefinition> = [
  diat,
  interconsultation,
  laboratory,
  imaging,
  contrast,
  consent,
  transfusion,
  tuberculosis,
  vdrl,
  serology,
  braden,
  ventilation,
  transfer,
] as ClinicalFormDefinition[];

export const PATIENT_CLINICAL_FORMS = CLINICAL_FORMS.filter(form => !form.internalOnly);

export const CLINICAL_VARIABLE_CATALOG = variables;
export const CLINICAL_VARIABLE_IDS = new Set(variables.variables.map(variable => variable.id));

export const getClinicalForm = (id: ClinicalFormId): ClinicalFormDefinition => {
  const form = CLINICAL_FORMS.find(candidate => candidate.id === id);
  if (!form) throw new Error('Formulario no disponible.');
  return form;
};
