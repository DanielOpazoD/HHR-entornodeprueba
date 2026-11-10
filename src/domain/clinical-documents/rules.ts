import type {
  ClinicalDocumentPatientFieldTemplate,
  ClinicalDocumentSectionTemplate,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';

export const CLINICAL_DOCUMENT_PATIENT_FIELDS: ClinicalDocumentPatientFieldTemplate[] = [
  { id: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Nombre Apellido' },
  { id: 'rut', label: 'Rut', type: 'text' },
  { id: 'edad', label: 'Edad', type: 'text', readonly: true, placeholder: 'años' },
  { id: 'fecnac', label: 'Fecha de nacimiento', type: 'date' },
  { id: 'fing', label: 'Fecha de ingreso', type: 'date' },
  { id: 'finf', label: 'Fecha del informe', type: 'date' },
  { id: 'hinf', label: 'Hora del informe', type: 'time' },
];

export const CLINICAL_DOCUMENT_EPICRISIS_SECTIONS: ClinicalDocumentSectionTemplate[] = [
  { id: 'antecedentes', title: 'Antecedentes', order: 0, required: true, visible: true },
  {
    id: 'historia-evolucion',
    title: 'Historia y evolución clínica',
    order: 1,
    required: true,
    visible: true,
  },
  {
    id: 'examenes-complementarios',
    title: 'Exámenes complementarios',
    order: 2,
    required: false,
    visible: false,
  },
  { id: 'diagnosticos', title: 'Diagnósticos de egreso', order: 3, required: false, visible: true },
  { id: 'plan', title: 'Indicaciones al alta', order: 4, required: true, visible: true },
];

export const CLINICAL_DOCUMENT_EVOLUTION_SECTIONS: ClinicalDocumentSectionTemplate[] = [
  { id: 'antecedentes', title: 'Antecedentes', order: 0, required: false, visible: true },
  {
    id: 'historia-evolucion',
    title: 'Historia y evolución clínica',
    order: 1,
    required: true,
    visible: true,
  },
  { id: 'plan', title: 'Plan', order: 2, required: true, visible: true },
];

export const CLINICAL_DOCUMENT_MEDICAL_REPORT_SECTIONS: ClinicalDocumentSectionTemplate[] = [
  { id: 'antecedentes', title: 'Antecedentes', order: 0, required: false, visible: true },
  {
    id: 'historia-evolucion',
    title: 'Historia y evolución clínica',
    order: 1,
    required: true,
    visible: true,
  },
  {
    id: 'examenes-complementarios',
    title: 'Exámenes complementarios',
    order: 2,
    required: false,
    visible: true,
  },
  { id: 'diagnosticos', title: 'Diagnósticos', order: 3, required: false, visible: true },
  { id: 'plan', title: 'Plan', order: 4, required: true, visible: true },
];

export const CLINICAL_DOCUMENT_CUSTOM_SECTIONS: ClinicalDocumentSectionTemplate[] = [
  { id: 'contenido', title: 'Contenido', order: 0, required: true, visible: true },
];

export const CLINICAL_DOCUMENT_TEMPLATES: Record<string, ClinicalDocumentTemplate> = {
  epicrisis: {
    id: 'epicrisis',
    documentType: 'epicrisis',
    name: 'Epicrisis médica',
    title: 'Epicrisis médica',
    defaultPatientInfoTitle: 'Información del Paciente',
    defaultFooterMedicoLabel: 'Médico',
    defaultFooterEspecialidadLabel: 'Especialidad',
    version: 1,
    patientFields: [...CLINICAL_DOCUMENT_PATIENT_FIELDS],
    sections: [...CLINICAL_DOCUMENT_EPICRISIS_SECTIONS],
    allowCustomTitle: false,
    allowAddSection: false,
    allowClinicalUpdateSections: false,
    status: 'active',
  },
  evolucion: {
    id: 'evolucion',
    documentType: 'evolucion',
    name: 'Evolución médica',
    title: 'Evolución médica',
    defaultPatientInfoTitle: 'Información del Paciente',
    defaultFooterMedicoLabel: 'Médico',
    defaultFooterEspecialidadLabel: 'Especialidad',
    version: 1,
    patientFields: [...CLINICAL_DOCUMENT_PATIENT_FIELDS],
    sections: [...CLINICAL_DOCUMENT_EVOLUTION_SECTIONS],
    allowCustomTitle: false,
    allowAddSection: false,
    allowClinicalUpdateSections: false,
    status: 'active',
  },
  informe_medico: {
    id: 'informe_medico',
    documentType: 'informe_medico',
    name: 'Informe médico',
    title: 'Informe médico',
    defaultPatientInfoTitle: 'Información del Paciente',
    defaultFooterMedicoLabel: 'Médico',
    defaultFooterEspecialidadLabel: 'Especialidad',
    version: 1,
    patientFields: [...CLINICAL_DOCUMENT_PATIENT_FIELDS],
    sections: [...CLINICAL_DOCUMENT_MEDICAL_REPORT_SECTIONS],
    allowCustomTitle: false,
    allowAddSection: false,
    allowClinicalUpdateSections: false,
    status: 'active',
  },
  epicrisis_traslado: {
    id: 'epicrisis_traslado',
    documentType: 'epicrisis_traslado',
    name: 'Epicrisis médica de traslado',
    title: 'Epicrisis médica de traslado',
    defaultPatientInfoTitle: 'Información del Paciente',
    defaultFooterMedicoLabel: 'Médico',
    defaultFooterEspecialidadLabel: 'Especialidad',
    version: 1,
    patientFields: [...CLINICAL_DOCUMENT_PATIENT_FIELDS],
    sections: [...CLINICAL_DOCUMENT_MEDICAL_REPORT_SECTIONS],
    allowCustomTitle: false,
    allowAddSection: false,
    allowClinicalUpdateSections: false,
    status: 'active',
  },
  otro: {
    id: 'otro',
    documentType: 'otro',
    name: 'Otro documento',
    title: 'Documento clínico',
    defaultPatientInfoTitle: 'Información del Paciente',
    defaultFooterMedicoLabel: 'Médico',
    defaultFooterEspecialidadLabel: 'Especialidad',
    version: 1,
    patientFields: [...CLINICAL_DOCUMENT_PATIENT_FIELDS],
    sections: [...CLINICAL_DOCUMENT_CUSTOM_SECTIONS],
    allowCustomTitle: true,
    allowAddSection: false,
    allowClinicalUpdateSections: false,
    status: 'active',
  },
};
