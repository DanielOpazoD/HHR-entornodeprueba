import type {
  ClinicalDocumentTemplate,
  ClinicalDocumentType,
} from '@/domain/clinical-documents/entities';
import { CLINICAL_DOCUMENT_TEMPLATES } from '@/features/clinical-documents/domain/rules';

/**
 * Returns all active clinical document templates sorted alphabetically (Spanish locale).
 * @returns Filtered and sorted array of active templates
 */
export const listActiveClinicalDocumentTemplates = (): ClinicalDocumentTemplate[] =>
  Object.values(CLINICAL_DOCUMENT_TEMPLATES)
    .filter(template => template.status === 'active')
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));

/**
 * Maps a clinical document type enum to its Spanish display label.
 * @param documentType - The document type identifier
 * @returns Human-readable label (e.g., "Epicrisis", "Evolucion")
 */
export const getClinicalDocumentTypeLabel = (documentType: ClinicalDocumentType): string => {
  switch (documentType) {
    case 'epicrisis':
      return 'Epicrisis';
    case 'evolucion':
      return 'Evolución';
    case 'informe_medico':
      return 'Informe';
    case 'epicrisis_traslado':
      return 'Epicrisis traslado';
    case 'otro':
      return 'Otro';
    default:
      return documentType;
  }
};
