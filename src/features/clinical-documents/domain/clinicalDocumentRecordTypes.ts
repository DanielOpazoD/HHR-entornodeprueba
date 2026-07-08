import type {
  ClinicalDocumentAuditActor,
  ClinicalDocumentIeehDraft,
  ClinicalDocumentPatientField,
  ClinicalDocumentPdfMeta,
  ClinicalDocumentSection,
  ClinicalDocumentStatus,
  ClinicalDocumentType,
  ClinicalDocumentVersionMeta,
} from './clinicalDocumentCoreTypes';

export interface ClinicalDocumentSignatureRevocation {
  revokedAt: string;
  revokedBy: ClinicalDocumentAuditActor;
  previousSignedAt?: string;
  reason: string;
}

export interface ClinicalDocumentAuditMeta {
  createdAt: string;
  createdBy: ClinicalDocumentAuditActor;
  updatedAt: string;
  updatedBy: ClinicalDocumentAuditActor;
  signedAt?: string;
  signedBy?: ClinicalDocumentAuditActor;
  unsignedAt?: string;
  unsignedBy?: ClinicalDocumentAuditActor;
  signatureRevocations?: ClinicalDocumentSignatureRevocation[];
  archivedAt?: string;
  archivedBy?: ClinicalDocumentAuditActor;
}

export interface ClinicalDocumentRecord {
  id: string;
  schemaVersion?: number;
  hospitalId: string;
  documentType: ClinicalDocumentType;
  templateId: string;
  templateVersion: number;
  title: string;
  patientInfoTitle: string;
  footerMedicoLabel: string;
  footerEspecialidadLabel: string;
  patientRut: string;
  patientName: string;
  episodeKey: string;
  admissionDate?: string;
  sourceDailyRecordDate?: string;
  sourceBedId?: string;
  patientFields: ClinicalDocumentPatientField[];
  sections: ClinicalDocumentSection[];
  medico: string;
  especialidad: string;
  status: ClinicalDocumentStatus;
  isLocked: boolean;
  /**
   * Reason for the lock, set automatically when an episode closes
   * (discharge home, transfer, death, fuga). Currently only
   * `'episode_closed'` is emitted; future reasons (manual admin lock,
   * compliance freeze, etc.) can extend this without breaking readers.
   */
  lockedReason?: 'episode_closed';
  /** ISO timestamp when the lock was applied. Set together with `isLocked`. */
  lockedAt?: string;
  isActiveEpisodeDocument: boolean;
  currentVersion: number;
  versionHistory: ClinicalDocumentVersionMeta[];
  audit: ClinicalDocumentAuditMeta;
  pdf?: ClinicalDocumentPdfMeta;
  renderedText?: string;
  integrityHash?: string;
  annexContent?: string;
  annexIncludedInPrint?: boolean;
  includePatientSignature?: boolean;
  ieehDraft?: ClinicalDocumentIeehDraft;
}
