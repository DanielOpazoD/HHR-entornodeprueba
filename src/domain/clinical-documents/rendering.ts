import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import { createClinicalDocumentHash } from '@/domain/clinical-documents/hash';

const stripTags = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|li)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const stripClinicalDocumentHtmlToText = (value: string): string => {
  if (!value.trim()) {
    return '';
  }

  if (typeof document === 'undefined') {
    return stripTags(value);
  }

  const container = document.createElement('div');
  container.innerHTML = value;
  return (container.textContent || '').replace(/\n{3,}/g, '\n\n').trim() || stripTags(value);
};

export const buildClinicalDocumentRenderedText = (
  record: Pick<
    ClinicalDocumentRecord,
    | 'title'
    | 'patientInfoTitle'
    | 'patientFields'
    | 'sections'
    | 'footerMedicoLabel'
    | 'footerEspecialidadLabel'
    | 'medico'
    | 'especialidad'
  >
): string => {
  const patientBlock = record.patientFields
    .filter(field => field.visible !== false)
    .map(field => `${field.label}: ${field.value || '—'}`)
    .join('\n');
  const sectionsBlock = record.sections
    .filter(section => section.visible !== false)
    .map(
      section =>
        `${section.title}\n${stripClinicalDocumentHtmlToText(section.content) || 'Sin contenido registrado.'}`
    )
    .join('\n\n');

  return [
    record.title,
    record.patientInfoTitle || 'Información del Paciente',
    patientBlock,
    sectionsBlock,
    `${record.footerMedicoLabel || 'Médico'}: ${record.medico || '—'}`,
    `${record.footerEspecialidadLabel || 'Especialidad'}: ${record.especialidad || '—'}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

export const buildClinicalDocumentIntegrityHash = (
  record: Pick<
    ClinicalDocumentRecord,
    | 'title'
    | 'patientInfoTitle'
    | 'patientFields'
    | 'sections'
    | 'footerMedicoLabel'
    | 'footerEspecialidadLabel'
    | 'medico'
    | 'especialidad'
  >
): string => createClinicalDocumentHash(buildClinicalDocumentRenderedText(record));
