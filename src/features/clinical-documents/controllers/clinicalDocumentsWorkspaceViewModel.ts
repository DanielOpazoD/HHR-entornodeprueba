import type { ConfirmOptions } from '@/context/uiContracts';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';
import type {
  ClinicalDocumentSheetAnnexBinding,
  ClinicalDocumentSheetAttachmentsBinding,
  ClinicalDocumentSheetDocumentActions,
  ClinicalDocumentSheetIeehBinding,
  ClinicalDocumentSheetIndicationsCatalogBinding,
  ClinicalDocumentSheetSignatureBinding,
  ClinicalDocumentUploadPastedImage,
} from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import type { ClinicalDocumentsSidebarProps } from '@/features/clinical-documents/contracts/clinicalDocumentsSidebarContracts';
import {
  executeClinicalDocumentTemplateRestore,
  handleClinicalDocumentTemplateSelection,
  toggleClinicalDocumentAnnex,
} from '@/features/clinical-documents/controllers/clinicalDocumentsWorkspaceActionController';

export interface ClinicalDocumentsWorkspaceChromeModel {
  isSaving: boolean;
  lastSavedAt?: string;
  hasLocalDraftChanges: boolean;
  flushPendingAutosave: () => void;
  onPrint: () => void;
  onRestoreTemplate: () => void;
}

export interface ClinicalDocumentsWorkspaceSheetModel {
  selectedDocument: ClinicalDocumentRecord | null;
  canEdit: boolean;
  chrome: ClinicalDocumentsWorkspaceChromeModel;
  documentActions: ClinicalDocumentSheetDocumentActions;
  indicationsCatalog: ClinicalDocumentSheetIndicationsCatalogBinding;
  attachments: ClinicalDocumentSheetAttachmentsBinding;
  annex: ClinicalDocumentSheetAnnexBinding;
  ieeh: ClinicalDocumentSheetIeehBinding;
  signature: ClinicalDocumentSheetSignatureBinding;
  onUploadPastedImage: ClinicalDocumentUploadPastedImage;
  onImagePasteRejected: (message: string) => void;
}

interface NotificationHelpers {
  info: (title: string, message?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface BuildSidebarPropsParams {
  canEdit: boolean;
  canDelete: boolean;
  canDeleteDocument: ClinicalDocumentsSidebarProps['canDeleteDocument'];
  readOnlyMessage: string | null;
  patientName?: string;
  patientRut?: string;
  templates: ClinicalDocumentsSidebarProps['templates'];
  selectedTemplateId: string;
  selectedDocumentId: string | null;
  documents: ClinicalDocumentsSidebarProps['documents'];
  draft: ClinicalDocumentRecord | null;
  setSelectedTemplateId: (templateId: string) => void;
  setSelectedDocumentId: (documentId: string | null) => void;
  createDocument: () => Promise<void>;
  handleDuplicateDocument: (
    document: ClinicalDocumentsSidebarProps['documents'][number]
  ) => Promise<void>;
  handleDeleteDocument: (
    document: ClinicalDocumentsSidebarProps['documents'][number]
  ) => Promise<void>;
  handleExportJson: (document: ClinicalDocumentsSidebarProps['documents'][number]) => void;
  handleImportJson: (file: File) => Promise<void>;
  handleImportWithAi: (file: File) => Promise<void>;
  isImportingWithAi: boolean;
  addClinicalUpdate: () => void;
  patchAnnexContent: ClinicalDocumentSheetAnnexBinding['onPatchContent'];
  patchSectionTitle: ClinicalDocumentSheetDocumentActions['patchSectionTitle'];
  patchSection: ClinicalDocumentSheetDocumentActions['patchSection'];
  scrollToAnnex: () => void;
}

interface BuildSheetModelParams {
  selectedDocument: ClinicalDocumentRecord | null;
  canEdit: boolean;
  isSaving: boolean;
  lastSavedAt?: string;
  hasLocalDraftChanges: boolean;
  flushPendingAutosave: () => void;
  attachments: ClinicalDocumentSheetAttachmentsBinding;
  uploadPastedImage: ClinicalDocumentUploadPastedImage;
  handlePrint: () => Promise<void>;
  draft: ClinicalDocumentRecord | null;
  restoreTemplateContent: () => void;
  notifications: NotificationHelpers;
  documentActions: ClinicalDocumentSheetDocumentActions;
  signature: ClinicalDocumentSheetSignatureBinding;
  indicationsCatalog: ClinicalDocumentSheetIndicationsCatalogBinding;
  annex: ClinicalDocumentSheetAnnexBinding;
  ieeh: ClinicalDocumentSheetIeehBinding;
}

export const scrollToClinicalDocumentAnnex = () => {
  window.setTimeout(() => {
    document.querySelector('.clinical-document-annex-page')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
};

export const buildClinicalDocumentsWorkspaceSidebarProps = ({
  canEdit,
  canDelete,
  canDeleteDocument,
  readOnlyMessage,
  patientName,
  patientRut,
  templates,
  selectedTemplateId,
  selectedDocumentId,
  documents,
  draft,
  setSelectedTemplateId,
  setSelectedDocumentId,
  createDocument,
  handleDuplicateDocument,
  handleDeleteDocument,
  handleExportJson,
  handleImportJson,
  handleImportWithAi,
  isImportingWithAi,
  addClinicalUpdate,
  patchAnnexContent,
  patchSectionTitle,
  patchSection,
  scrollToAnnex,
}: BuildSidebarPropsParams): ClinicalDocumentsSidebarProps => ({
  canEdit,
  canDelete,
  canDeleteDocument,
  readOnlyMessage,
  patientName,
  patientRut,
  templates,
  selectedTemplateId,
  onSelectTemplate: templateId =>
    handleClinicalDocumentTemplateSelection({
      templateId,
      setSelectedTemplateId,
    }),
  onCreateDocument: () => void createDocument(),
  documents,
  selectedDocumentId,
  onSelectDocument: setSelectedDocumentId,
  onDuplicateDocument: document => void handleDuplicateDocument(document),
  onDeleteDocument: document => void handleDeleteDocument(document),
  onExportJson: handleExportJson,
  onImportJson: file => void handleImportJson(file),
  onImportWithAi: file => void handleImportWithAi(file),
  isImportingWithAi,
  onAddClinicalUpdate: canEdit ? addClinicalUpdate : undefined,
  onToggleAnnex: canEdit
    ? () =>
        toggleClinicalDocumentAnnex({
          draft,
          canEdit,
          patchAnnexContent,
          scrollToAnnex,
        })
    : undefined,
  hasAnnex: draft?.annexContent != null,
  onRestoreVersionSection:
    canEdit && draft
      ? section => {
          patchSectionTitle(section.sectionId, section.title);
          patchSection(section.sectionId, section.content);
        }
      : undefined,
});

export const buildClinicalDocumentsWorkspaceSheetModel = ({
  selectedDocument,
  canEdit,
  isSaving,
  lastSavedAt,
  hasLocalDraftChanges,
  flushPendingAutosave,
  attachments,
  uploadPastedImage,
  handlePrint,
  draft,
  restoreTemplateContent,
  notifications,
  documentActions,
  signature,
  indicationsCatalog,
  annex,
  ieeh,
}: BuildSheetModelParams): ClinicalDocumentsWorkspaceSheetModel => ({
  selectedDocument,
  canEdit,
  chrome: {
    isSaving,
    lastSavedAt,
    hasLocalDraftChanges,
    flushPendingAutosave,
    onPrint: handlePrint,
    onRestoreTemplate: () =>
      void executeClinicalDocumentTemplateRestore({
        draft,
        canEdit,
        confirm: notifications.confirm,
        restoreTemplateContent,
        info: notifications.info,
      }),
  },
  documentActions,
  indicationsCatalog,
  attachments,
  annex,
  ieeh,
  signature,
  onUploadPastedImage: uploadPastedImage,
  onImagePasteRejected: message => notifications.info('Imagen no insertada', message),
});
