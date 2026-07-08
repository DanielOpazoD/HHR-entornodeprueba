import type {
  ClinicalDocumentRecord,
  ClinicalDocumentVersionSectionSnapshot,
} from '@/features/clinical-documents/domain/entities';

export interface ClinicalDocumentsSidebarTemplateOption {
  id: string;
  name: string;
}

export interface ClinicalDocumentsSidebarProps {
  canEdit: boolean;
  canDelete: boolean;
  readOnlyMessage?: string | null;
  patientName?: string;
  patientRut?: string;
  templates: ClinicalDocumentsSidebarTemplateOption[];
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onCreateDocument: () => void;
  documents: ClinicalDocumentRecord[];
  selectedDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  onDuplicateDocument: (document: ClinicalDocumentRecord) => void;
  onDeleteDocument: (document: ClinicalDocumentRecord) => void;
  canDeleteDocument?: (document: ClinicalDocumentRecord) => boolean;
  onExportJson?: (document: ClinicalDocumentRecord) => void;
  onImportJson?: (file: File) => void;
  onImportWithAi?: (file: File) => void;
  isImportingWithAi?: boolean;
  onAddClinicalUpdate?: () => void;
  onToggleAnnex?: () => void;
  hasAnnex?: boolean;
  onRestoreVersionSection?: (
    section: Pick<ClinicalDocumentVersionSectionSnapshot, 'sectionId' | 'title' | 'content'>
  ) => void;
  onOpenLabDialog?: () => void;
  onOpenMMRADDialog?: () => void;
}
