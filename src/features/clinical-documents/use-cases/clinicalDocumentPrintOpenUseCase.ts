import {
  openClinicalDocumentBrowserPrintPreview,
  type ClinicalDocumentAnnexPrintMode,
  type ClinicalDocumentRecord,
} from '@/features/clinical-documents/internal';

export const executeOpenClinicalDocumentPrint = (
  record: ClinicalDocumentRecord,
  options: { annexMode?: ClinicalDocumentAnnexPrintMode } = {}
): Promise<boolean> =>
  openClinicalDocumentBrowserPrintPreview(record.title, record.documentType, record.ieehDraft, {
    annexMode: options.annexMode,
    includePatientSignature: record.includePatientSignature ?? true,
  });
