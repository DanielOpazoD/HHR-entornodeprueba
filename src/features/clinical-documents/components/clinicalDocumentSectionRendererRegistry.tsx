import React from 'react';

import type { ClinicalDocumentSpecialSectionRendererProps } from '@/features/clinical-documents/components/clinicalDocumentSheetShared';
import { ClinicalDocumentRichTextEditor } from '@/features/clinical-documents/components/ClinicalDocumentRichTextEditor';
import { ClinicalDocumentPlanSection } from '@/features/clinical-documents/components/ClinicalDocumentPlanSection';
import {
  resolveClinicalDocumentEmptySectionTemplate,
  resolveClinicalDocumentMandatoryListType,
} from '@/features/clinical-documents/controllers/clinicalDocumentEmptySectionTemplateController';
import {
  getClinicalDocumentDefinition,
  type ClinicalDocumentSectionRendererId,
} from '@/features/clinical-documents/domain/definitions';

const specialSectionRenderers: Record<
  Exclude<ClinicalDocumentSectionRendererId, 'standard'>,
  React.FC<ClinicalDocumentSpecialSectionRendererProps>
> = {
  plan_subsections: ClinicalDocumentPlanSection,
};

export const renderClinicalDocumentSectionContent = (
  props: ClinicalDocumentSpecialSectionRendererProps
): React.ReactNode => {
  const rendererId =
    getClinicalDocumentDefinition(props.document.documentType).sectionRenderers[props.section.id] ||
    'standard';

  if (rendererId === 'standard') {
    return (
      <ClinicalDocumentRichTextEditor
        sectionId={props.section.id}
        sectionTitle={props.section.title}
        value={props.section.content}
        emptyTemplate={resolveClinicalDocumentEmptySectionTemplate(props.section.id)}
        mandatoryListType={resolveClinicalDocumentMandatoryListType(props.section.id)}
        onChange={content => props.onPatchSection(props.section.id, content)}
        onActivate={props.onEditorActivate}
        onDeactivate={props.onEditorDeactivate}
        onUploadPastedImage={props.onUploadPastedImage}
        onImagePasteRejected={props.onImagePasteRejected}
        disabled={!props.canEdit || props.document.isLocked}
      />
    );
  }

  const Renderer = specialSectionRenderers[rendererId];
  return <Renderer {...props} />;
};
