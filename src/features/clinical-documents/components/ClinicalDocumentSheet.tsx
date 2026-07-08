import React from 'react';
import { Eye } from 'lucide-react';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { getTodayISO } from '@/utils/dateCoreUtils';

import { ClinicalDocumentFooterSection } from '@/features/clinical-documents/components/ClinicalDocumentFooterSection';
import { ClinicalDocumentLockBanner } from '@/features/clinical-documents/components/ClinicalDocumentLockBanner';
import { ClinicalDocumentPatientInfoSection } from '@/features/clinical-documents/components/ClinicalDocumentPatientInfoSection';
import { ClinicalDocumentSectionList } from '@/features/clinical-documents/components/ClinicalDocumentSectionList';
import { ClinicalDocumentSheetHeader } from '@/features/clinical-documents/components/ClinicalDocumentSheetHeader';
import { ClinicalDocumentAnnexPage } from '@/features/clinical-documents/components/ClinicalDocumentAnnexPage';
import { ClinicalAttachmentsPanel } from '@/features/clinical-documents/components/ClinicalAttachmentsPanel';
import type { ClinicalDocumentSheetProps } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';

export const ClinicalDocumentSheet: React.FC<ClinicalDocumentSheetProps> = ({
  selectedDocument,
  canEdit,
  toolbar,
  activeTitleTarget,
  activeEditorSectionId,
  onSetActiveTitleTarget,
  draggedSectionId,
  dragOverSectionId,
  activePlanSubsectionId,
  activeIndicationsSpecialtyId,
  isIndicationsPanelOpen,
  onSetActivePlanSubsectionId,
  onSetActiveIndicationsSpecialtyId,
  onToggleIndicationsPanel,
  onEditorActivate,
  onEditorDeactivate,
  onImagePasteRejected,
  attachments,
  patientAttachments,
  isLoadingAttachments,
  isLoadingPatientAttachments,
  isUploadingAttachment,
  uploadStatusMessage,
  onUploadAttachment,
  onDeleteAttachment,
  onRenameAttachment,
  onRegenerateAttachmentAccess,
  onSuggestAttachmentName,
  onUploadPastedImage,
  dragHandlers,
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
  importIndicationsCatalog,
  patchAnnexContent,
  setAnnexIncludedInPrint,
  clearAnnexContent,
  onPrintAnnex,
  patchIeehDraft,
  clearIeehDraft,
  workspacePatient,
  patchUpdateDate,
  patchUpdateTime,
}) => {
  if (!selectedDocument) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        Selecciona o crea un documento clínico para comenzar.
      </div>
    );
  }

  const visiblePatientFields = selectedDocument.patientFields.filter(
    field => field.visible !== false
  );
  const hiddenPatientFields = selectedDocument.patientFields.filter(
    field => field.visible === false
  );
  const visibleSections = selectedDocument.sections
    .filter(section => section.visible !== false)
    .sort((left, right) => left.order - right.order);
  const hiddenSections = selectedDocument.sections.filter(
    section => section.visible === false && section.kind !== 'clinical-update'
  );

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      {toolbar}

      <ClinicalDocumentLockBanner
        isLocked={selectedDocument.isLocked}
        lockedReason={selectedDocument.lockedReason}
        lockedAt={selectedDocument.lockedAt}
      />

      <div id="clinical-document-sheet" className="clinical-document-sheet">
        <ClinicalDocumentSheetHeader
          title={selectedDocument.title}
          canEdit={canEdit}
          isLocked={selectedDocument.isLocked}
          onChangeTitle={patchDocumentTitle}
        />

        {(hiddenPatientFields.length > 0 || hiddenSections.length > 0) && (
          <div className="clinical-document-restore-panel">
            {hiddenPatientFields.map(field => (
              <button
                key={field.id}
                type="button"
                className="clinical-document-restore-chip"
                onClick={() => setPatientFieldVisibility(field.id, true)}
                disabled={!canEdit || selectedDocument.isLocked}
              >
                <Eye size={12} />
                Restaurar campo: {field.label || field.id}
              </button>
            ))}
            {hiddenSections.map(section => (
              <button
                key={section.id}
                type="button"
                className="clinical-document-restore-chip"
                onClick={() => setSectionVisibility(section.id, true)}
                disabled={!canEdit || selectedDocument.isLocked}
              >
                <Eye size={12} />
                Restaurar sección: {section.title || section.id}
              </button>
            ))}
          </div>
        )}

        <ClinicalDocumentPatientInfoSection
          document={selectedDocument}
          visiblePatientFields={visiblePatientFields}
          canEdit={canEdit}
          activeTitleTarget={activeTitleTarget}
          onSetActiveTitleTarget={onSetActiveTitleTarget}
          onPatchPatientInfoTitle={patchPatientInfoTitle}
          onPatchPatientFieldLabel={patchPatientFieldLabel}
          onPatchPatientField={patchPatientField}
          onSetPatientFieldVisibility={setPatientFieldVisibility}
        />

        <ClinicalDocumentSectionList
          document={selectedDocument}
          visibleSections={visibleSections}
          canEdit={canEdit}
          activeTitleTarget={activeTitleTarget}
          activeEditorSectionId={activeEditorSectionId}
          draggedSectionId={draggedSectionId}
          dragOverSectionId={dragOverSectionId}
          activePlanSubsectionId={activePlanSubsectionId}
          activeIndicationsSpecialtyId={activeIndicationsSpecialtyId}
          isIndicationsPanelOpen={isIndicationsPanelOpen}
          indicationsCatalog={indicationsCatalog}
          isSavingCustomIndication={isSavingCustomIndication}
          customIndicationError={customIndicationError}
          onCreateIndicationsTab={createIndicationsTab}
          onRenameIndicationsTab={renameIndicationsTab}
          onDeleteIndicationsTab={deleteIndicationsTab}
          onReorderIndicationsTab={reorderIndicationsTab}
          onSetActiveTitleTarget={onSetActiveTitleTarget}
          onPatchSectionTitle={patchSectionTitle}
          onPatchSection={patchSection}
          onSetSectionLayout={setSectionLayout}
          onSetSectionVisibility={setSectionVisibility}
          onMoveSection={moveSection}
          onReorderSection={reorderSection}
          onAddSection={addSection}
          onEditorActivate={onEditorActivate}
          onEditorDeactivate={onEditorDeactivate}
          onUploadPastedImage={onUploadPastedImage}
          onImagePasteRejected={onImagePasteRejected}
          onSetActivePlanSubsectionId={onSetActivePlanSubsectionId}
          onSetActiveIndicationsSpecialtyId={onSetActiveIndicationsSpecialtyId}
          onToggleIndicationsPanel={onToggleIndicationsPanel}
          onAddCustomIndication={addCustomIndication}
          onUpdateIndication={updateIndication}
          onDeleteIndication={deleteIndication}
          onImportIndicationsCatalog={importIndicationsCatalog}
          onPatchIeehDraft={patchIeehDraft}
          onClearIeehDraft={clearIeehDraft}
          workspacePatient={workspacePatient}
          onPatchUpdateDate={patchUpdateDate}
          onPatchUpdateTime={patchUpdateTime}
          dragHandlers={dragHandlers}
        />

        <ClinicalDocumentFooterSection
          document={selectedDocument}
          canEdit={canEdit}
          onPatchFooterLabel={patchFooterLabel}
          onPatchDocumentMeta={patchDocumentMeta}
          signatureProfile={signatureProfile}
          onSaveSignatureProfile={onSaveSignatureProfile}
          onApplySignatureProfile={onApplySignatureProfile}
          onClearActiveTitleTarget={() => onSetActiveTitleTarget(null)}
        />

        {/* Annex page (printed as next page via CSS page-break) */}
        {selectedDocument.annexContent != null && (
          <ClinicalDocumentAnnexPage
            content={selectedDocument.annexContent}
            canEdit={canEdit}
            isLocked={selectedDocument.isLocked}
            patientName={selectedDocument.patientName}
            currentDateLabel={formatDateDDMMYYYY(getTodayISO())}
            includedInGlobalPrint={selectedDocument.annexIncludedInPrint ?? true}
            isEditorActive={activeEditorSectionId === 'annexes'}
            onChange={patchAnnexContent}
            onToggleIncludedInGlobalPrint={setAnnexIncludedInPrint}
            onPrintAnnex={onPrintAnnex}
            onClear={clearAnnexContent}
            onEditorActivate={onEditorActivate}
            onEditorDeactivate={onEditorDeactivate}
            onUploadPastedImage={onUploadPastedImage}
            onImagePasteRejected={onImagePasteRejected}
          />
        )}
      </div>

      <ClinicalAttachmentsPanel
        canEdit={canEdit && !selectedDocument.isLocked}
        currentDocumentId={selectedDocument.id}
        currentEpisodeKey={selectedDocument.episodeKey}
        attachments={attachments}
        patientAttachments={patientAttachments}
        isLoading={isLoadingAttachments}
        isLoadingPatientAttachments={isLoadingPatientAttachments}
        isUploading={isUploadingAttachment}
        uploadStatusMessage={uploadStatusMessage}
        onUploadAttachment={onUploadAttachment}
        onDeleteAttachment={onDeleteAttachment}
        onRenameAttachment={onRenameAttachment}
        onRegenerateAttachmentAccess={onRegenerateAttachmentAccess}
        onSuggestAttachmentName={onSuggestAttachmentName}
      />
    </div>
  );
};
