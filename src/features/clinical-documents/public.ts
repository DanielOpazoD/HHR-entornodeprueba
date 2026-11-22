// Public API for code outside the clinical-documents feature. Internal consumers should import local modules directly.
export { ClinicalDocumentsModal } from './components/ClinicalDocumentsModal';
export { ClinicalDocumentsPanel } from './components/ClinicalDocumentsPanel';
export { ClinicalDocumentsWorkspace } from './components/ClinicalDocumentsWorkspace';
export type {
  ClinicalAttachmentFileKind,
  ClinicalAttachmentRecord,
} from '@/features/clinical-documents/contracts/clinicalAttachmentContracts';
export type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentPdfMeta,
  ClinicalDocumentRecord,
  ClinicalDocumentTemplate,
  ClinicalDocumentPatientFieldTemplate,
  ClinicalDocumentSectionTemplate,
  ClinicalDocumentPatientField,
  ClinicalDocumentSection,
  ClinicalDocumentStatus,
  ClinicalDocumentType,
} from '@/domain/clinical-documents/entities';
export type { ClinicalDocumentsWorkspacePatientContract } from './contracts/clinicalDocumentsPatientContract';
export type { ClinicalDocumentDraftBaseState } from './hooks/clinicalDocumentDraftReducer';
export {
  buildClinicalDocumentActor,
  serializeClinicalDocument,
} from './controllers/clinicalDocumentWorkspaceController';
export {
  buildClinicalAttachmentStoragePath,
  normalizeClinicalAttachmentRutKey,
} from './controllers/clinicalAttachmentPathController';
export { resolveClinicalAttachmentFilePolicy } from './controllers/clinicalAttachmentFilePolicy';
export { parseClinicalAttachmentRecord } from './contracts/clinicalAttachmentRuntimeContracts';
export { generateClinicalDocumentPdfBlob } from './services/clinicalDocumentPdfService';
export { openClinicalDocumentBrowserPrintPreview } from './services/clinicalDocumentBrowserPrintService';
export type { ClinicalDocumentAnnexPrintMode } from './services/clinicalDocumentPrintSupport';
