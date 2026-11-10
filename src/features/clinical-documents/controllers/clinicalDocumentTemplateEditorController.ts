import type {
  ClinicalDocumentPatientFieldTemplate,
  ClinicalDocumentSectionTemplate,
  ClinicalDocumentTemplate,
} from '@/domain/clinical-documents/entities';

const sanitizeText = (value: string, fallback: string): string => {
  const next = value.trim();
  return next.length > 0 ? next : fallback;
};

/** Creates a new blank section template at the given order position. */
export const createTemplateSection = (order: number): ClinicalDocumentSectionTemplate => ({
  id: `section-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  title: 'Nueva sección',
  order,
  required: false,
  visible: true,
});

/** Creates a new blank patient field template with default values. */
export const createTemplatePatientField = (): ClinicalDocumentPatientFieldTemplate => ({
  id: `field-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  label: 'Nuevo campo',
  type: 'text',
  placeholder: '',
  readonly: false,
});

/**
 * Normalizes a template before persisting: re-indexes sections, sanitizes empty text fields, and ensures boolean defaults.
 * @param template - The raw template to normalize.
 * @returns A clean copy ready for storage.
 */
export const normalizeTemplateForSave = (
  template: ClinicalDocumentTemplate
): ClinicalDocumentTemplate => {
  const normalizedSections = [...template.sections]
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({
      ...section,
      id: sanitizeText(section.id, `section-${index + 1}`),
      title: sanitizeText(section.title, `Sección ${index + 1}`),
      order: index,
      required: Boolean(section.required),
      visible: section.visible !== false,
    }));

  const normalizedFields = template.patientFields.map((field, index) => ({
    ...field,
    id: sanitizeText(field.id, `field-${index + 1}`),
    label: sanitizeText(field.label, `Campo ${index + 1}`),
    placeholder: field.placeholder ?? '',
    readonly: Boolean(field.readonly),
  }));

  return {
    ...template,
    name: sanitizeText(template.name, 'Plantilla clínica'),
    title: sanitizeText(template.title, 'Documento clínico'),
    defaultPatientInfoTitle: sanitizeText(
      template.defaultPatientInfoTitle || '',
      'Información del Paciente'
    ),
    defaultFooterMedicoLabel: sanitizeText(template.defaultFooterMedicoLabel || '', 'Médico'),
    defaultFooterEspecialidadLabel: sanitizeText(
      template.defaultFooterEspecialidadLabel || '',
      'Especialidad'
    ),
    patientFields: normalizedFields,
    sections: normalizedSections,
  };
};
