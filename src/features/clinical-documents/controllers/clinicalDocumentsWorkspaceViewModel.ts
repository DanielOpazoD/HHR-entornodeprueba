import type { ConfirmOptions } from '@/context/uiContracts';
import type { ClinicalDocumentSheetProps } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import type { ClinicalDocumentsSidebarProps } from '@/features/clinical-documents/contracts/clinicalDocumentsSidebarContracts';
import {
  executeClinicalDocumentTemplateRestore,
  handleClinicalDocumentTemplateSelection,
  toggleClinicalDocumentAnnex,
} from '@/features/clinical-documents/controllers/clinicalDocumentsWorkspaceActionController';

type ClinicalDocumentsWorkspaceSheetModelProps = Omit<
  ClinicalDocumentSheetProps,
  | 'toolbar'
  | 'activeTitleTarget'
  | 'activeEditorSectionId'
  | 'onSetActiveTitleTarget'
  | 'draggedSectionId'
  | 'dragOverSectionId'
  | 'activePlanSubsectionId'
  | 'activeIndicationsSpecialtyId'
  | 'isIndicationsPanelOpen'
  | 'onSetActivePlanSubsectionId'
  | 'onSetActiveIndicationsSpecialtyId'
  | 'onToggleIndicationsPanel'
  | 'onEditorActivate'
  | 'onEditorDeactivate'
  | 'dragHandlers'
>;

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
  draft: ClinicalDocumentsWorkspaceSheetModelProps['selectedDocument'];
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
  addClinicalUpdate: ClinicalDocumentsWorkspaceSheetModelProps['addClinicalUpdate'];
  patchAnnexContent: ClinicalDocumentsWorkspaceSheetModelProps['patchAnnexContent'];
  patchSectionTitle: ClinicalDocumentsWorkspaceSheetModelProps['patchSectionTitle'];
  patchSection: ClinicalDocumentsWorkspaceSheetModelProps['patchSection'];
  scrollToAnnex: () => void;
}

interface BuildSheetPropsParams {
  selectedDocument: ClinicalDocumentsWorkspaceSheetModelProps['selectedDocument'];
  canEdit: boolean;
  isSaving: boolean;
  lastSavedAt?: string;
  hasLocalDraftChanges: boolean;
  flushPendingAutosave: ClinicalDocumentsWorkspaceSheetModelProps['flushPendingAutosave'];
  isUploadingPdf: boolean;
  validationIssues: ClinicalDocumentsWorkspaceSheetModelProps['validationIssues'];
  attachments: ClinicalDocumentsWorkspaceSheetModelProps['attachments'];
  patientAttachments: ClinicalDocumentsWorkspaceSheetModelProps['patientAttachments'];
  isLoadingAttachments: boolean;
  isLoadingPatientAttachments: boolean;
  isUploadingAttachment: boolean;
  uploadStatusMessage: string | null;
  uploadAttachment: ClinicalDocumentsWorkspaceSheetModelProps['onUploadAttachment'];
  deleteAttachment: ClinicalDocumentsWorkspaceSheetModelProps['onDeleteAttachment'];
  renameAttachment: ClinicalDocumentsWorkspaceSheetModelProps['onRenameAttachment'];
  regenerateAttachmentAccess: ClinicalDocumentsWorkspaceSheetModelProps['onRegenerateAttachmentAccess'];
  suggestAttachmentName: ClinicalDocumentsWorkspaceSheetModelProps['onSuggestAttachmentName'];
  uploadPastedImage: ClinicalDocumentsWorkspaceSheetModelProps['onUploadPastedImage'];
  handlePrint: () => Promise<void>;
  handleUploadPdf: () => Promise<void>;
  draft: ClinicalDocumentsWorkspaceSheetModelProps['selectedDocument'];
  restoreTemplateContent: ClinicalDocumentsWorkspaceSheetModelProps['onRestoreTemplate'];
  notifications: NotificationHelpers;
  patchDocumentTitle: ClinicalDocumentsWorkspaceSheetModelProps['patchDocumentTitle'];
  patchPatientInfoTitle: ClinicalDocumentsWorkspaceSheetModelProps['patchPatientInfoTitle'];
  patchPatientField: ClinicalDocumentsWorkspaceSheetModelProps['patchPatientField'];
  patchPatientFieldLabel: ClinicalDocumentsWorkspaceSheetModelProps['patchPatientFieldLabel'];
  setPatientFieldVisibility: ClinicalDocumentsWorkspaceSheetModelProps['setPatientFieldVisibility'];
  patchSectionTitle: ClinicalDocumentsWorkspaceSheetModelProps['patchSectionTitle'];
  patchSection: ClinicalDocumentsWorkspaceSheetModelProps['patchSection'];
  setSectionLayout: ClinicalDocumentsWorkspaceSheetModelProps['setSectionLayout'];
  setSectionVisibility: ClinicalDocumentsWorkspaceSheetModelProps['setSectionVisibility'];
  moveSection: ClinicalDocumentsWorkspaceSheetModelProps['moveSection'];
  reorderSection: ClinicalDocumentsWorkspaceSheetModelProps['reorderSection'];
  addSection: ClinicalDocumentsWorkspaceSheetModelProps['addSection'];
  patchFooterLabel: ClinicalDocumentsWorkspaceSheetModelProps['patchFooterLabel'];
  patchDocumentMeta: ClinicalDocumentsWorkspaceSheetModelProps['patchDocumentMeta'];
  signatureProfile: ClinicalDocumentsWorkspaceSheetModelProps['signatureProfile'];
  onSaveSignatureProfile: ClinicalDocumentsWorkspaceSheetModelProps['onSaveSignatureProfile'];
  onApplySignatureProfile: ClinicalDocumentsWorkspaceSheetModelProps['onApplySignatureProfile'];
  indicationsCatalog: ClinicalDocumentsWorkspaceSheetModelProps['indicationsCatalog'];
  isSavingCustomIndication: boolean;
  customIndicationError: string | null;
  createIndicationsTab: ClinicalDocumentsWorkspaceSheetModelProps['createIndicationsTab'];
  renameIndicationsTab: ClinicalDocumentsWorkspaceSheetModelProps['renameIndicationsTab'];
  deleteIndicationsTab: ClinicalDocumentsWorkspaceSheetModelProps['deleteIndicationsTab'];
  reorderIndicationsTab: ClinicalDocumentsWorkspaceSheetModelProps['reorderIndicationsTab'];
  addCustomIndication: ClinicalDocumentsWorkspaceSheetModelProps['addCustomIndication'];
  updateIndication: ClinicalDocumentsWorkspaceSheetModelProps['updateIndication'];
  deleteIndication: ClinicalDocumentsWorkspaceSheetModelProps['deleteIndication'];
  importCatalog: ClinicalDocumentsWorkspaceSheetModelProps['importIndicationsCatalog'];
  addClinicalUpdate: ClinicalDocumentsWorkspaceSheetModelProps['addClinicalUpdate'];
  patchAnnexContent: ClinicalDocumentsWorkspaceSheetModelProps['patchAnnexContent'];
  setAnnexIncludedInPrint: ClinicalDocumentsWorkspaceSheetModelProps['setAnnexIncludedInPrint'];
  clearAnnexContent: ClinicalDocumentsWorkspaceSheetModelProps['clearAnnexContent'];
  handlePrintAnnex: () => Promise<void>;
  patchIeehDraft: ClinicalDocumentsWorkspaceSheetModelProps['patchIeehDraft'];
  clearIeehDraft: ClinicalDocumentsWorkspaceSheetModelProps['clearIeehDraft'];
  workspacePatient: ClinicalDocumentsWorkspaceSheetModelProps['workspacePatient'];
  patchUpdateDate: ClinicalDocumentsWorkspaceSheetModelProps['patchUpdateDate'];
  patchUpdateTime: ClinicalDocumentsWorkspaceSheetModelProps['patchUpdateTime'];
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

export const buildClinicalDocumentsWorkspaceSheetProps = ({
  selectedDocument,
  canEdit,
  isSaving,
  lastSavedAt,
  hasLocalDraftChanges,
  flushPendingAutosave,
  isUploadingPdf,
  validationIssues,
  attachments,
  patientAttachments,
  isLoadingAttachments,
  isLoadingPatientAttachments,
  isUploadingAttachment,
  uploadStatusMessage,
  uploadAttachment,
  deleteAttachment,
  renameAttachment,
  regenerateAttachmentAccess,
  suggestAttachmentName,
  uploadPastedImage,
  handlePrint,
  handleUploadPdf,
  draft,
  restoreTemplateContent,
  notifications,
  patchDocumentTitle,
  patchPatientInfoTitle,
  patchPatientField,
  patchPatientFieldLabel,
  setPatientFieldVisibility,
  patchSectionTitle,
  patchSection,
  setSectionLayout,
  setSectionVisibility,
  moveSection,
  reorderSection,
  addSection,
  patchFooterLabel,
  patchDocumentMeta,
  signatureProfile,
  onSaveSignatureProfile,
  onApplySignatureProfile,
  indicationsCatalog,
  isSavingCustomIndication,
  customIndicationError,
  createIndicationsTab,
  renameIndicationsTab,
  deleteIndicationsTab,
  reorderIndicationsTab,
  addCustomIndication,
  updateIndication,
  deleteIndication,
  importCatalog,
  addClinicalUpdate,
  patchAnnexContent,
  setAnnexIncludedInPrint,
  clearAnnexContent,
  handlePrintAnnex,
  patchIeehDraft,
  clearIeehDraft,
  workspacePatient,
  patchUpdateDate,
  patchUpdateTime,
}: BuildSheetPropsParams): ClinicalDocumentsWorkspaceSheetModelProps => ({
  selectedDocument,
  canEdit,
  isSaving,
  lastSavedAt,
  hasLocalDraftChanges,
  flushPendingAutosave,
  isUploadingPdf,
  validationIssues,
  attachments,
  currentDocumentId: selectedDocument?.id ?? null,
  patientAttachments,
  isLoadingAttachments,
  isLoadingPatientAttachments,
  isUploadingAttachment,
  uploadStatusMessage,
  onUploadAttachment: uploadAttachment,
  onDeleteAttachment: deleteAttachment,
  onRenameAttachment: renameAttachment,
  onRegenerateAttachmentAccess: regenerateAttachmentAccess,
  onSuggestAttachmentName: suggestAttachmentName,
  onUploadPastedImage: uploadPastedImage,
  onPrint: handlePrint,
  onUploadPdf: () => void handleUploadPdf(),
  onRestoreTemplate: () =>
    void executeClinicalDocumentTemplateRestore({
      draft,
      canEdit,
      confirm: notifications.confirm,
      restoreTemplateContent,
      info: notifications.info,
    }),
  onImagePasteRejected: message => notifications.info('Imagen no insertada', message),
  patchDocumentTitle,
  patchPatientInfoTitle,
  patchPatientField,
  patchPatientFieldLabel,
  setPatientFieldVisibility,
  patchSectionTitle,
  patchSection,
  setSectionLayout,
  setSectionVisibility,
  moveSection,
  reorderSection,
  addSection,
  patchFooterLabel,
  patchDocumentMeta,
  signatureProfile,
  onSaveSignatureProfile,
  onApplySignatureProfile,
  indicationsCatalog,
  isSavingCustomIndication,
  customIndicationError,
  createIndicationsTab,
  renameIndicationsTab,
  deleteIndicationsTab,
  reorderIndicationsTab,
  addCustomIndication,
  updateIndication,
  deleteIndication,
  importIndicationsCatalog: importCatalog,
  addClinicalUpdate,
  patchAnnexContent,
  setAnnexIncludedInPrint,
  clearAnnexContent,
  onPrintAnnex: handlePrintAnnex,
  patchIeehDraft,
  clearIeehDraft,
  workspacePatient,
  patchUpdateDate,
  patchUpdateTime,
});

export type { ClinicalDocumentsWorkspaceSheetModelProps };
