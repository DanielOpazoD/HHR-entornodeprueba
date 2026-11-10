import type {
  ClinicalDocumentSectionTemplate,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';
import {
  CLINICAL_DOCUMENT_CUSTOM_SECTIONS,
  CLINICAL_DOCUMENT_EPICRISIS_SECTIONS,
  CLINICAL_DOCUMENT_MEDICAL_REPORT_SECTIONS,
  CLINICAL_DOCUMENT_PATIENT_FIELDS,
} from '@/domain/clinical-documents/rules';

// The evolution sections and the templates below differ from the ones in
// `@/domain/clinical-documents/rules` (an extra section in "evolucion", another
// "epicrisis_traslado"). Both are kept on purpose until the owner decides which is right.
export const CLINICAL_DOCUMENT_EVOLUTION_SECTIONS: ClinicalDocumentSectionTemplate[] = [
  { id: 'antecedentes', title: 'Antecedentes', order: 0, required: false, visible: true },
  {
    id: 'historia-evolucion',
    title: 'Historia y evolución clínica',
    order: 1,
    required: true,
    visible: true,
  },
  {
    id: 'diagnosticos',
    title: 'Diagnósticos actuales',
    order: 2,
    required: false,
    visible: true,
  },
  { id: 'plan', title: 'Plan', order: 3, required: true, visible: true },
] as const;

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
  epicrisis_traslado: {
    id: 'epicrisis_traslado',
    documentType: 'epicrisis_traslado',
    name: 'Epicrisis traslado',
    title: 'Epicrisis traslado',
    defaultPatientInfoTitle: 'Información del Paciente',
    defaultFooterMedicoLabel: 'Médico',
    defaultFooterEspecialidadLabel: 'Especialidad',
    version: 1,
    patientFields: [...CLINICAL_DOCUMENT_PATIENT_FIELDS],
    sections: [
      ...CLINICAL_DOCUMENT_EPICRISIS_SECTIONS.map(section =>
        section.id === 'plan'
          ? { ...section, title: 'Plan de egreso', visible: true }
          : {
              ...section,
              visible: section.id === 'examenes-complementarios' ? true : section.visible,
            }
      ),
    ],
    allowCustomTitle: false,
    allowAddSection: false,
    allowClinicalUpdateSections: false,
    status: 'archived',
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
} as const;

export const DEFAULT_CLINICAL_DOCUMENT_TEMPLATE_ID = 'epicrisis';
