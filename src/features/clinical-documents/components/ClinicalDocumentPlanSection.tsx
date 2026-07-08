import React from 'react';

import {
  buildUnifiedClinicalDocumentPlanSectionContent,
  CLINICAL_DOCUMENT_PLAN_SUBSECTIONS,
  parseClinicalDocumentPlanSectionContent,
  resolveClinicalDocumentPlanSectionLayout,
  updateClinicalDocumentPlanSubsectionContent,
} from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import {
  resolveClinicalDocumentEmptySectionTemplate,
  resolveClinicalDocumentMandatoryListType,
} from '@/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController';
import { ClinicalDocumentRichTextEditor } from '@/features/clinical-documents/components/ClinicalDocumentRichTextEditor';
import type { ClinicalDocumentSpecialSectionRendererProps } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';

export const ClinicalDocumentPlanSection: React.FC<ClinicalDocumentSpecialSectionRendererProps> = ({
  document,
  section,
  canEdit,
  activePlanSubsectionId: _activePlanSubsectionId,
  setActivePlanSubsectionId,
  onPatchSection,
  onEditorActivate,
  onEditorDeactivate,
  onUploadPastedImage,
  onImagePasteRejected,
}) => {
  const sectionLayout = resolveClinicalDocumentPlanSectionLayout(section);
  const parsedPlanContent = parseClinicalDocumentPlanSectionContent(section.content);

  if (sectionLayout === 'unified') {
    return (
      <div className="clinical-document-plan-subsections-shell">
        <ClinicalDocumentRichTextEditor
          sectionId={section.id}
          sectionTitle={section.title}
          value={buildUnifiedClinicalDocumentPlanSectionContent(section.content)}
          emptyTemplate={resolveClinicalDocumentEmptySectionTemplate(section.id)}
          mandatoryListType={resolveClinicalDocumentMandatoryListType(section.id)}
          onChange={content =>
            onPatchSection(section.id, buildUnifiedClinicalDocumentPlanSectionContent(content))
          }
          onActivate={onEditorActivate}
          onDeactivate={onEditorDeactivate}
          onUploadPastedImage={onUploadPastedImage}
          onImagePasteRejected={onImagePasteRejected}
          disabled={!canEdit || document.isLocked}
        />
      </div>
    );
  }

  return (
    <div className="clinical-document-plan-subsections-shell">
      <div className="clinical-document-plan-subsections">
        {CLINICAL_DOCUMENT_PLAN_SUBSECTIONS.map(subsection => (
          <div key={subsection.id} className="clinical-document-plan-subsection">
            <div className="clinical-document-plan-subsection-title">{subsection.title}</div>
            <ClinicalDocumentRichTextEditor
              sectionId={`${section.id}:${subsection.id}`}
              sectionTitle={subsection.title}
              value={parsedPlanContent[subsection.id]}
              emptyTemplate={resolveClinicalDocumentEmptySectionTemplate(
                `${section.id}:${subsection.id}`
              )}
              mandatoryListType={resolveClinicalDocumentMandatoryListType(
                `${section.id}:${subsection.id}`
              )}
              onChange={content =>
                onPatchSection(
                  section.id,
                  updateClinicalDocumentPlanSubsectionContent(
                    section.content,
                    subsection.id,
                    content
                  )
                )
              }
              onActivate={(activeSectionId, editorApi) => {
                setActivePlanSubsectionId(subsection.id);
                onEditorActivate(activeSectionId, editorApi);
              }}
              onDeactivate={onEditorDeactivate}
              onUploadPastedImage={onUploadPastedImage}
              onImagePasteRejected={onImagePasteRejected}
              disabled={!canEdit || document.isLocked}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
