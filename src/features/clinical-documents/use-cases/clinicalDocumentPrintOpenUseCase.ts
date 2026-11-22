import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import { openClinicalDocumentBrowserPrintPreview } from '../services/clinicalDocumentBrowserPrintService';
import type { ClinicalDocumentAnnexPrintMode } from '../services/clinicalDocumentPrintSupport';

export const executeOpenClinicalDocumentPrint = (
  record: ClinicalDocumentRecord,
  options: { annexMode?: ClinicalDocumentAnnexPrintMode } = {}
): Promise<boolean> =>
  openClinicalDocumentBrowserPrintPreview(record.title, record.documentType, record.ieehDraft, {
    annexMode: options.annexMode,
    includePatientSignature: record.includePatientSignature ?? true,
  });
