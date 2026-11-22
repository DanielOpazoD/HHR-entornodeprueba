import type { ClinicalDocumentIeehDraft } from '@/features/clinical-documents/contracts/ieehContracts';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentSectionLayout,
} from '@/domain/clinical-documents/entities';
import type { ClinicalAttachmentRecord } from '@/features/clinical-documents/contracts/clinicalAttachmentContracts';
import type { ClinicalDocumentSignatureProfile } from '@/features/clinical-documents/services/clinicalDocumentSignatureProfileService';
import type { ClinicalDocumentPlanSubsectionId } from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import type { ClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import type { DragEvent, ReactNode, SetStateAction } from 'react';

export type ClinicalDocumentFormattingCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'indent'
  | 'outdent'
  | 'removeFormat'
  | 'undo'
  | 'redo';

export interface ClinicalDocumentSheetEditorApi {
  element: HTMLDivElement | null;
  canUndo: boolean;
  canRedo: boolean;
  applyCommand: (command: ClinicalDocumentFormattingCommand, value?: string) => void;
  insertHtml: (html: string) => void;
}

export interface ClinicalDocumentUploadedPastedImage {
  attachmentId: string;
  imageUrl: string;
  storagePath: string;
}

export type ClinicalDocumentUploadPastedImage = (
  file: File
) => Promise<ClinicalDocumentUploadedPastedImage | null>;

export interface ClinicalDocumentSectionDragHandlers {
  onDragStart: (event: DragEvent<HTMLButtonElement>, sectionId: string) => void;
  onDragOver: (event: DragEvent<HTMLElement>, sectionId: string, canInteract: boolean) => void;
  onDragLeave: (sectionId: string) => void;
  onDragEnd: () => void;
}

export interface ClinicalDocumentSheetSectionActions {
  patchSectionTitle: (sectionId: string, title: string) => void;
  patchSection: (sectionId: string, content: string) => void;
  setSectionLayout: (sectionId: string, layout: ClinicalDocumentSectionLayout) => void;
  setSectionVisibility: (sectionId: string, visible: boolean) => void;
  moveSection: (sectionId: string, direction: 'up' | 'down') => void;
  reorderSection: (sourceSectionId: string, targetSectionId: string) => void;
  addSection: (referenceSectionId: string, position: 'above' | 'below') => void;
  patchUpdateDate?: (sectionId: string, date: string) => void;
  patchUpdateTime?: (sectionId: string, time: string) => void;
}

export interface ClinicalDocumentSheetDocumentActions extends ClinicalDocumentSheetSectionActions {
  patchDocumentTitle: (title: string) => void;
  patchPatientInfoTitle: (title: string) => void;
  patchPatientField: (fieldId: string, value: string) => void;
  patchPatientFieldLabel: (fieldId: string, label: string) => void;
  setPatientFieldVisibility: (fieldId: string, visible: boolean) => void;
  patchFooterLabel: (kind: 'medico' | 'especialidad', title: string) => void;
  patchDocumentMeta: (
    patch: Partial<
      Pick<ClinicalDocumentRecord, 'medico' | 'especialidad' | 'includePatientSignature'>
    >
  ) => void;
}

export interface ClinicalDocumentSheetEditorState {
  activeTitleTarget: string | null;
  activeEditorSectionId: string | null;
  onSetActiveTitleTarget: React.Dispatch<SetStateAction<string | null>>;
  draggedSectionId: string | null;
  dragOverSectionId: string | null;
  dragHandlers: ClinicalDocumentSectionDragHandlers;
  activePlanSubsectionId: ClinicalDocumentPlanSubsectionId;
  onSetActivePlanSubsectionId: (subsectionId: ClinicalDocumentPlanSubsectionId) => void;
  onEditorActivate: (activeSectionId: string, editorApi: ClinicalDocumentSheetEditorApi) => void;
  onEditorDeactivate: (sectionId: string) => void;
  onUploadPastedImage: ClinicalDocumentUploadPastedImage;
  onImagePasteRejected: (message: string) => void;
}

export interface ClinicalDocumentSheetIndicationsCatalogBinding {
  catalog: ClinicalDocumentIndicationsCatalog;
  isSavingCustomIndication: boolean;
  customIndicationError: string | null;
  onCreateTab: (label: string) => Promise<boolean>;
  onRenameTab: (tabId: string, label: string) => Promise<boolean>;
  onDeleteTab: (tabId: string) => Promise<boolean>;
  onAddCustomIndication: (tabId: string, text: string) => Promise<boolean>;
  onUpdateIndication: (tabId: string, itemId: string, text: string) => Promise<boolean>;
  onDeleteIndication: (tabId: string, itemId: string) => Promise<boolean>;
  onImportCatalog: (catalog: unknown) => Promise<boolean>;
}

export interface ClinicalDocumentSheetIndicationsBinding extends ClinicalDocumentSheetIndicationsCatalogBinding {
  isPanelOpen: boolean;
  onTogglePanel: () => void;
}

export interface ClinicalDocumentSheetAttachmentsBinding {
  items: ClinicalAttachmentRecord[];
  patientItems: ClinicalAttachmentRecord[];
  isLoading: boolean;
  isLoadingPatient: boolean;
  isUploading: boolean;
  uploadStatusMessage: string | null;
  onUpload: (file: File) => Promise<void> | void;
  onDelete: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onRename: (attachment: ClinicalAttachmentRecord, displayName: string) => Promise<void> | void;
  onRegenerateAccess: (attachment: ClinicalAttachmentRecord) => Promise<void> | void;
  onSuggestName: (attachment: ClinicalAttachmentRecord) => Promise<string | null>;
}

export interface ClinicalDocumentSheetAnnexBinding {
  onPatchContent: (content: string) => void;
  onSetIncludedInPrint: (included: boolean) => void;
  onClear: () => void;
  onPrint: () => void;
}

export interface ClinicalDocumentSheetIeehBinding {
  onPatchDraft: (draft: ClinicalDocumentIeehDraft) => void;
  onClearDraft: () => void;
  /** Workspace patient data (provides birthDate for IEEH printing). */
  workspacePatient?: { birthDate?: string };
}

export interface ClinicalDocumentSheetSignatureBinding {
  profile?: ClinicalDocumentSignatureProfile | null;
  onSave?: () => void;
  onApply?: () => void;
}

export interface ClinicalDocumentSheetProps {
  selectedDocument: ClinicalDocumentRecord | null;
  canEdit: boolean;
  toolbar?: ReactNode;
  documentActions: ClinicalDocumentSheetDocumentActions;
  editorState: ClinicalDocumentSheetEditorState;
  indications: ClinicalDocumentSheetIndicationsBinding;
  attachments: ClinicalDocumentSheetAttachmentsBinding;
  annex: ClinicalDocumentSheetAnnexBinding;
  ieeh: ClinicalDocumentSheetIeehBinding;
  signature?: ClinicalDocumentSheetSignatureBinding;
}

export interface ClinicalDocumentSpecialSectionRendererProps {
  document: ClinicalDocumentRecord;
  section: ClinicalDocumentRecord['sections'][number];
  canEdit: boolean;
  setActivePlanSubsectionId: (subsectionId: ClinicalDocumentPlanSubsectionId) => void;
  onPatchSection: (sectionId: string, content: string) => void;
  onEditorActivate: (activeSectionId: string, editorApi: ClinicalDocumentSheetEditorApi) => void;
  onEditorDeactivate: (sectionId: string) => void;
  onUploadPastedImage: ClinicalDocumentUploadPastedImage;
  onImagePasteRejected: (message: string) => void;
}
