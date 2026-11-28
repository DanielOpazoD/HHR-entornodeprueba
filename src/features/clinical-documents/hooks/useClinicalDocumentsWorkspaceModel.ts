import type { ClinicalDocumentsWorkspacePatientContract } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';

import type { ClinicalDocumentsSidebarProps } from '@/features/clinical-documents/contracts/clinicalDocumentsSidebarContracts';
import {
  buildClinicalDocumentsWorkspaceSheetModel,
  buildClinicalDocumentsWorkspaceSidebarProps,
  scrollToClinicalDocumentAnnex,
  type ClinicalDocumentsWorkspaceSheetModel,
} from '@/features/clinical-documents/controllers/clinicalDocumentsWorkspaceViewModel';
import { useClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/hooks/useClinicalDocumentIndicationsCatalog';
import { useClinicalAttachments } from '@/features/clinical-documents/hooks/useClinicalAttachments';
import { useClinicalDocumentWorkspaceBootstrap } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap';
import { useClinicalDocumentWorkspaceDraft } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft';
import { useClinicalDocumentWorkspaceDocumentActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDocumentActions';
import { useClinicalDocumentWorkspaceExportActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceExportActions';
import { useClinicalDocumentSignatureProfile } from '@/features/clinical-documents/hooks/useClinicalDocumentSignatureProfile';
import { buildClinicalDocumentSignatureProfileFromDraft } from '@/features/clinical-documents/services/clinicalDocumentSignatureProfileService';
import {
  canDeleteClinicalDocumentFromWorkspace,
  mergeDraftIntoClinicalDocumentsSidebar,
  resolveClinicalDocumentsWorkspaceAccessState,
} from './clinicalDocumentsWorkspaceModelSupport';
import { useNotification } from '@/context/UIContext';
import { buildClinicalDocumentWorkspaceNotifyPort } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';

const useClinicalDocumentsWorkspaceNotifyPort = () => {
  const { success, warning, error: notifyError, info, confirm } = useNotification();

  const notifyPort = useMemo(
    () => buildClinicalDocumentWorkspaceNotifyPort(success, warning, notifyError, info, confirm),
    [confirm, info, notifyError, success, warning]
  );

  return {
    notifyPort,
    info,
    confirm,
  };
};

interface UseClinicalDocumentsWorkspaceModelParams {
  patient: ClinicalDocumentsWorkspacePatientContract;
  currentDateString: string;
  bedId: string;
  isActive: boolean;
}

interface ClinicalDocumentsWorkspaceModel {
  canRead: boolean;
  episodeKey: string;
  sidebarProps: ClinicalDocumentsSidebarProps;
  sheetModel: ClinicalDocumentsWorkspaceSheetModel;
}

export const useClinicalDocumentsWorkspaceModel = ({
  patient,
  currentDateString,
  bedId,
  isActive,
}: UseClinicalDocumentsWorkspaceModelParams): ClinicalDocumentsWorkspaceModel => {
  const { currentUser: user, role } = useAuth();
  const { notifyPort, info, confirm } = useClinicalDocumentsWorkspaceNotifyPort();
  const [isImportingWithAi, setIsImportingWithAi] = useState(false);

  const {
    canRead,
    canEdit,
    canDelete,
    canDeleteByRole,
    canMutateEpisode,
    readOnlyMessage,
    persistReason,
  } = useMemo(() => resolveClinicalDocumentsWorkspaceAccessState(patient, role), [patient, role]);
  const hospitalId = getActiveHospitalId();

  const {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    documents,
    selectedDocumentId,
    setSelectedDocumentId,
    readStatus,
    retryDocuments,
    episode,
  } = useClinicalDocumentWorkspaceBootstrap({
    patient,
    currentDateString,
    bedId,
    isActive,
    canRead,
    hospitalId,
    role,
  });

  const {
    draft,
    hasLocalDraftChanges,
    setDraft,
    isSaving,
    lastSavedAt,
    lastPersistedSnapshotRef,
    flushPendingAutosave,
    patchPatientField,
    patchPatientFieldLabel,
    setPatientFieldVisibility,
    patchSection,
    patchSectionTitle,
    setSectionLayout,
    setSectionVisibility,
    moveSection,
    reorderSection,
    addSection,
    patchDocumentTitle,
    patchPatientInfoTitle,
    patchFooterLabel,
    patchDocumentMeta,
    restoreTemplateContent,
    addClinicalUpdate,
    patchAnnexContent,
    setAnnexIncludedInPrint,
    clearAnnexContent,
    patchIeehDraft,
    clearIeehDraft,
    patchUpdateDate,
    patchUpdateTime,
  } = useClinicalDocumentWorkspaceDraft({
    documents,
    selectedDocumentId,
    canEdit,
    isActive,
    hospitalId,
    role,
    persistReason,
    user,
  });
  const guardedSetSelectedDocumentId = useCallback(
    (nextDocumentId: string | null) => {
      flushPendingAutosave();
      setSelectedDocumentId(nextDocumentId);
    },
    [flushPendingAutosave, setSelectedDocumentId]
  );

  const { signatureProfile, saveSignatureProfile } = useClinicalDocumentSignatureProfile({
    user,
    isActive: isActive && canRead,
  });

  const selectedDocument = draft;
  const {
    attachments,
    patientAttachments,
    isLoadingAttachments,
    isLoadingPatientAttachments,
    isUploadingAttachment,
    uploadStatusMessage,
    uploadAttachment,
    uploadPastedImage,
    deleteAttachment,
    renameAttachment,
    regenerateAttachmentAccess,
    suggestAttachmentName,
  } = useClinicalAttachments({
    selectedDocument,
    hospitalId,
    canEdit,
    user,
    role,
    notify: notifyPort,
  });
  const sidebarDocuments = useMemo(
    () => mergeDraftIntoClinicalDocumentsSidebar(documents, draft),
    [documents, draft]
  );
  const canDeleteDocument = useCallback(
    (document: (typeof sidebarDocuments)[number]) =>
      canDeleteClinicalDocumentFromWorkspace({
        document,
        canDeleteByRole,
        canMutateEpisode,
        role,
        user,
      }),
    [canDeleteByRole, canMutateEpisode, role, user]
  );

  const {
    indicationsCatalog,
    isSavingCustomIndication,
    customIndicationError,
    createTab,
    renameTab,
    deleteTab,
    addCustomIndication,
    updateIndication,
    deleteIndication,
    importCatalog,
  } = useClinicalDocumentIndicationsCatalog({
    user,
    isActive,
    canEdit,
  });

  const {
    createDocument,
    handleDeleteDocument,
    handleDuplicateDocument,
    handleImportJson,
    handleImportWithAi,
  } = useClinicalDocumentWorkspaceDocumentActions({
    patient,
    role,
    user,
    hospitalId,
    episode,
    selectedTemplateId,
    templates,
    selectedDocumentId,
    canEdit,
    canDelete,
    canDeleteDocument,
    notify: notifyPort,
    setSelectedDocumentId: guardedSetSelectedDocumentId,
    setDraft,
    lastPersistedSnapshotRef,
    signatureProfile,
  });

  const handleSaveSignatureProfile = useCallback(async () => {
    if (!draft || !user) {
      return;
    }

    try {
      await saveSignatureProfile(buildClinicalDocumentSignatureProfileFromDraft(user, draft));
      notifyPort.success(
        'Firma guardada',
        'Tu nombre y especialidad quedarán disponibles solo para tu cuenta.'
      );
    } catch (error) {
      notifyPort.error(
        'No se pudo guardar la firma',
        error instanceof Error
          ? error.message
          : 'Revisa nombre y especialidad e inténtalo de nuevo.'
      );
    }
  }, [draft, notifyPort, saveSignatureProfile, user]);

  const handleApplySignatureProfile = useCallback(() => {
    if (!signatureProfile) {
      return;
    }

    patchDocumentMeta({
      medico: signatureProfile.displayName,
      especialidad: signatureProfile.specialty,
    });
  }, [patchDocumentMeta, signatureProfile]);

  const handleImportWithAiProgress = useCallback(
    async (file: File) => {
      if (isImportingWithAi) {
        return;
      }

      setIsImportingWithAi(true);
      try {
        await handleImportWithAi(file);
      } finally {
        setIsImportingWithAi(false);
      }
    },
    [handleImportWithAi, isImportingWithAi]
  );

  const { handleExportJson, handlePrint, handlePrintAnnex } =
    useClinicalDocumentWorkspaceExportActions({
      selectedDocument,
      notify: notifyPort,
    });

  const scrollToAnnex = useCallback(() => {
    scrollToClinicalDocumentAnnex();
  }, []);

  return {
    canRead,
    episodeKey: episode.episodeKey,
    sidebarProps: buildClinicalDocumentsWorkspaceSidebarProps({
      canEdit,
      canDelete,
      canDeleteDocument,
      readOnlyMessage,
      patientName: patient.patientName,
      patientRut: patient.rut,
      templates,
      selectedTemplateId,
      selectedDocumentId,
      documents: sidebarDocuments,
      readStatus,
      retryDocuments,
      draft,
      setSelectedTemplateId,
      setSelectedDocumentId: guardedSetSelectedDocumentId,
      createDocument,
      handleDuplicateDocument,
      handleDeleteDocument,
      handleExportJson,
      handleImportJson,
      handleImportWithAi: handleImportWithAiProgress,
      isImportingWithAi,
      addClinicalUpdate,
      patchAnnexContent,
      patchSectionTitle,
      patchSection,
      scrollToAnnex,
    }),
    sheetModel: buildClinicalDocumentsWorkspaceSheetModel({
      selectedDocument,
      canEdit,
      isSaving,
      lastSavedAt,
      hasLocalDraftChanges,
      flushPendingAutosave,
      attachments: {
        items: attachments,
        patientItems: patientAttachments,
        isLoading: isLoadingAttachments,
        isLoadingPatient: isLoadingPatientAttachments,
        isUploading: isUploadingAttachment,
        uploadStatusMessage,
        onUpload: uploadAttachment,
        onDelete: deleteAttachment,
        onRename: renameAttachment,
        onRegenerateAccess: regenerateAttachmentAccess,
        onSuggestName: suggestAttachmentName,
      },
      uploadPastedImage,
      handlePrint,
      draft,
      restoreTemplateContent,
      notifications: { info, confirm },
      documentActions: {
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
        patchUpdateDate,
        patchUpdateTime,
      },
      signature: {
        profile: signatureProfile,
        onSave: handleSaveSignatureProfile,
        onApply: handleApplySignatureProfile,
      },
      indicationsCatalog: {
        catalog: indicationsCatalog,
        isSavingCustomIndication,
        customIndicationError,
        onCreateTab: createTab,
        onRenameTab: renameTab,
        onDeleteTab: deleteTab,
        onAddCustomIndication: addCustomIndication,
        onUpdateIndication: updateIndication,
        onDeleteIndication: deleteIndication,
        onImportCatalog: importCatalog,
      },
      annex: {
        onPatchContent: patchAnnexContent,
        onSetIncludedInPrint: setAnnexIncludedInPrint,
        onClear: clearAnnexContent,
        onPrint: handlePrintAnnex,
      },
      ieeh: {
        onPatchDraft: patchIeehDraft,
        onClearDraft: clearIeehDraft,
        workspacePatient: patient,
      },
    }),
  };
};
