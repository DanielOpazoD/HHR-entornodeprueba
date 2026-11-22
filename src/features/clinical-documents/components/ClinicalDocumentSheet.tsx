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
  documentActions,
  editorState,
  indications,
  attachments,
  annex,
  ieeh,
  signature,
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
          onChangeTitle={documentActions.patchDocumentTitle}
        />

        {(hiddenPatientFields.length > 0 || hiddenSections.length > 0) && (
          <div className="clinical-document-restore-panel">
            {hiddenPatientFields.map(field => (
              <button
                key={field.id}
                type="button"
                className="clinical-document-restore-chip"
                onClick={() => documentActions.setPatientFieldVisibility(field.id, true)}
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
                onClick={() => documentActions.setSectionVisibility(section.id, true)}
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
          activeTitleTarget={editorState.activeTitleTarget}
          onSetActiveTitleTarget={editorState.onSetActiveTitleTarget}
          onPatchPatientInfoTitle={documentActions.patchPatientInfoTitle}
          onPatchPatientFieldLabel={documentActions.patchPatientFieldLabel}
          onPatchPatientField={documentActions.patchPatientField}
          onSetPatientFieldVisibility={documentActions.setPatientFieldVisibility}
        />

        <ClinicalDocumentSectionList
          document={selectedDocument}
          visibleSections={visibleSections}
          canEdit={canEdit}
          sectionActions={documentActions}
          editorState={editorState}
          indications={indications}
          ieeh={ieeh}
        />

        <ClinicalDocumentFooterSection
          document={selectedDocument}
          canEdit={canEdit}
          onPatchFooterLabel={documentActions.patchFooterLabel}
          onPatchDocumentMeta={documentActions.patchDocumentMeta}
          signatureProfile={signature?.profile}
          onSaveSignatureProfile={signature?.onSave}
          onApplySignatureProfile={signature?.onApply}
          onClearActiveTitleTarget={() => editorState.onSetActiveTitleTarget(null)}
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
            isEditorActive={editorState.activeEditorSectionId === 'annexes'}
            onChange={annex.onPatchContent}
            onToggleIncludedInGlobalPrint={annex.onSetIncludedInPrint}
            onPrintAnnex={annex.onPrint}
            onClear={annex.onClear}
            onEditorActivate={editorState.onEditorActivate}
            onEditorDeactivate={editorState.onEditorDeactivate}
            onUploadPastedImage={editorState.onUploadPastedImage}
            onImagePasteRejected={editorState.onImagePasteRejected}
          />
        )}
      </div>

      <ClinicalAttachmentsPanel
        canEdit={canEdit && !selectedDocument.isLocked}
        currentDocumentId={selectedDocument.id}
        currentEpisodeKey={selectedDocument.episodeKey}
        attachments={attachments.items}
        patientAttachments={attachments.patientItems}
        isLoading={attachments.isLoading}
        isLoadingPatientAttachments={attachments.isLoadingPatient}
        isUploading={attachments.isUploading}
        uploadStatusMessage={attachments.uploadStatusMessage}
        onUploadAttachment={attachments.onUpload}
        onDeleteAttachment={attachments.onDelete}
        onRenameAttachment={attachments.onRename}
        onRegenerateAttachmentAccess={attachments.onRegenerateAccess}
        onSuggestAttachmentName={attachments.onSuggestName}
      />
    </div>
  );
};
