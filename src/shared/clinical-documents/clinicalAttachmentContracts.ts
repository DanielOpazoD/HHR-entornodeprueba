export type ClinicalAttachmentDocumentType =
  | 'epicrisis'
  | 'evolucion'
  | 'informe_medico'
  | 'epicrisis_traslado'
  | 'otro';

export interface ClinicalAttachmentAuditActor {
  uid: string;
  email: string;
  displayName: string;
  role: string;
}

export type ClinicalAttachmentFileKind = 'image' | 'pdf' | 'docx' | 'other';
export type ClinicalAttachmentStatus = 'active' | 'deleted' | 'upload_failed';
export type ClinicalAttachmentSource =
  | 'file-picker'
  | 'pasted-image'
  | 'document-section'
  | 'episode';

export interface ClinicalAttachmentImageMeta {
  width?: number;
  height?: number;
  compressed: boolean;
  originalSizeBytes?: number;
  compressionQuality?: number;
}

export interface ClinicalAttachmentRecord {
  id: string;
  hospitalId: string;
  patientRut: string;
  patientRutKey: string;
  patientName?: string;
  episodeKey: string;
  admissionDate?: string;
  sourceDailyRecordDate?: string;
  bedId?: string;
  documentId?: string;
  documentType?: ClinicalAttachmentDocumentType;
  sectionId?: string;
  storagePath: string;
  downloadUrl?: string;
  originalFileName: string;
  displayName: string;
  contentType: string;
  fileKind: ClinicalAttachmentFileKind;
  sizeBytes: number;
  image?: ClinicalAttachmentImageMeta;
  status: ClinicalAttachmentStatus;
  createdAt: string;
  createdBy: ClinicalAttachmentAuditActor;
  updatedAt: string;
  updatedBy: ClinicalAttachmentAuditActor;
  deletedAt?: string;
  deletedBy?: ClinicalAttachmentAuditActor;
}
