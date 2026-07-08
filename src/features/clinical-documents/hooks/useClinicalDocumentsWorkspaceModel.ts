import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import type { ClinicalDocumentsSidebarProps } from '@/features/clinical-documents/contracts/clinicalDocumentsSidebarContracts';
import {
  buildClinicalDocumentsWorkspaceSheetProps,
  buildClinicalDocumentsWorkspaceSidebarProps,
  scrollToClinicalDocumentAnnex,
  type ClinicalDocumentsWorkspaceSheetModelProps,
} from '@/features/clinical-documents/controllers/clinicalDocumentsWorkspaceViewModel';
import { useClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/hooks/useClinicalDocumentIndicationsCatalog';
import { useClinicalAttachments } from '@/features/clinical-documents/hooks/useClinicalAttachments';
import { useClinicalDocumentWorkspaceBootstrap } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap';
import { useClinicalDocumentWorkspaceDraft } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft';
import { useClinicalDocumentWorkspaceDocumentActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDocumentActions';
import { useClinicalDocumentWorkspaceExportActions } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceExportActions';
import { useClinicalDocumentSignatureProfile } from '@/features/clinical-documents/hooks/useClinicalDocumentSignatureProfile';
import { useClinicalDocumentsWorkspaceNotifyPort } from '@/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceNotifyPort';
import { buildClinicalDocumentSignatureProfileFromDraft } from '@/features/clinical-documents/services/clinicalDocumentSignatureProfileService';
import {
  canDeleteClinicalDocumentFromWorkspace,
  mergeDraftIntoClinicalDocumentsSidebar,
  resolveClinicalDocumentsWorkspaceAccessState,
} from './clinicalDocumentsWorkspaceModelSupport';

interface UseClinicalDocumentsWorkspaceModelParams {
  patient: PatientData;
  currentDateString: string;
  bedId: string;
  isActive: boolean;
}

type ClinicalDocumentsWorkspaceSheetProps = ClinicalDocumentsWorkspaceSheetModelProps;

interface ClinicalDocumentsWorkspaceModel {
  canRead: boolean;
  sidebarProps: ClinicalDocumentsSidebarProps;
  sheetProps: ClinicalDocumentsWorkspaceSheetProps;
}

export const useClinicalDocumentsWorkspaceModel = ({
  patient,
  currentDateString,
  bedId,
  isActive,
}: UseClinicalDocumentsWorkspaceModelParams): ClinicalDocumentsWorkspaceModel => {
  const { user, role } = useAuth();
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
    validationIssues,
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
    reorderTab,
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

  const { handleExportJson, handlePrint, handlePrintAnnex, handleUploadPdf, isUploadingPdf } =
    useClinicalDocumentWorkspaceExportActions({
      selectedDocument,
      hospitalId,
      notify: notifyPort,
      setDraft,
    });

  const scrollToAnnex = useCallback(() => {
    scrollToClinicalDocumentAnnex();
  }, []);

  return {
    canRead,
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
    sheetProps: buildClinicalDocumentsWorkspaceSheetProps({
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
      notifications: { info, confirm },
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
      onSaveSignatureProfile: handleSaveSignatureProfile,
      onApplySignatureProfile: handleApplySignatureProfile,
      indicationsCatalog,
      isSavingCustomIndication,
      customIndicationError,
      createIndicationsTab: createTab,
      renameIndicationsTab: renameTab,
      deleteIndicationsTab: deleteTab,
      reorderIndicationsTab: reorderTab,
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
      workspacePatient: patient,
      patchUpdateDate,
      patchUpdateTime,
    }),
  };
};
