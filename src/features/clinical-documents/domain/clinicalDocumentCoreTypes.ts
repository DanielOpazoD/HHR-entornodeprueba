import type {
  ClinicalDocumentIeehDraft,
  IeehBinaryFlag,
  IeehDischargeConditionCode,
} from '@/application/shared/ieehContracts';
import type {
  ClinicalDocumentSection,
  ClinicalDocumentSectionKind,
  ClinicalDocumentSectionLayout,
} from '@/domain/clinical-documents/entities';

export type ClinicalDocumentType =
  | 'epicrisis'
  | 'evolucion'
  | 'informe_medico'
  | 'epicrisis_traslado'
  | 'otro';

export type ClinicalDocumentStatus = 'draft' | 'ready_for_signature' | 'signed' | 'archived';

export interface ClinicalDocumentPatientField {
  id: string;
  label: string;
  value: string;
  type: 'text' | 'date' | 'number' | 'time';
  placeholder?: string;
  readonly?: boolean;
  visible?: boolean;
}

export type { ClinicalDocumentSection, ClinicalDocumentSectionKind, ClinicalDocumentSectionLayout };

export interface ClinicalDocumentAuditActor {
  uid: string;
  email: string;
  displayName: string;
  role: string;
}

export interface ClinicalDocumentVersionSectionSnapshot {
  sectionId: string;
  title: string;
  content: string;
  order: number;
  kind?: ClinicalDocumentSectionKind;
}

export interface ClinicalDocumentVersionMeta {
  version: number;
  savedAt: string;
  savedBy: ClinicalDocumentAuditActor;
  reason: 'autosave' | 'manual' | 'signature' | 'unsign' | 'admin_fix' | 'ai_import';
  changedSectionIds?: string[];
  sectionSnapshots?: ClinicalDocumentVersionSectionSnapshot[];
}

export interface ClinicalDocumentPdfMeta {
  fileId?: string;
  webViewLink?: string;
  folderPath?: string;
  exportedAt?: string;
  exportStatus?: 'pending' | 'exported' | 'failed';
  exportError?: string;
}

export type { ClinicalDocumentIeehDraft, IeehBinaryFlag, IeehDischargeConditionCode };
