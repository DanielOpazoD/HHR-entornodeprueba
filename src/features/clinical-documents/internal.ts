// Internal collaboration surface for application/shared modules that need
// feature-owned clinical document contracts without re-entering the UI barrel.
export type {
  ClinicalAttachmentRecord,
  ClinicalAttachmentFileKind,
  ClinicalDocumentAuditActor,
  ClinicalDocumentPdfMeta,
  ClinicalDocumentRecord,
  ClinicalDocumentStatus,
  ClinicalDocumentTemplate,
  ClinicalDocumentType,
} from './domain/entities';
export type { PatientData } from './contracts/clinicalDocumentsPatientContract';
export type { ClinicalDocumentDraftBaseState } from './hooks/clinicalDocumentDraftReducer';
export {
  buildClinicalDocumentActor,
  hydrateClinicalDocumentWorkspaceRecord,
  serializeClinicalDocument,
} from './controllers/clinicalDocumentWorkspaceController';
export {
  CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES,
  CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES,
  CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES,
  CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES,
  resolveClinicalAttachmentFilePolicy,
} from './controllers/clinicalAttachmentFilePolicy';
export {
  buildClinicalAttachmentStoragePath,
  normalizeClinicalAttachmentRutKey,
} from './controllers/clinicalAttachmentPathController';
export {
  compressClinicalAttachmentImage,
  type ClinicalAttachmentImageCompressionResult,
} from './controllers/clinicalAttachmentImageCompressionController';
export { duplicateClinicalDocumentDraft } from './domain/factories';
export { parseClinicalAttachmentRecord } from './contracts/clinicalAttachmentRuntimeContracts';
export { safeParseClinicalDocumentRecord } from './contracts/clinicalDocumentRuntimeContracts';
export { exportClinicalDocumentPdfViaBackend } from './services/clinicalDocumentBackendExportService';
export { generateClinicalDocumentPdfBlob } from './services/clinicalDocumentPdfService';
export { openClinicalDocumentBrowserPrintPreview } from './services/clinicalDocumentPrintPdfService';
export type { ClinicalDocumentAnnexPrintMode } from './services/clinicalDocumentPrintSupport';
