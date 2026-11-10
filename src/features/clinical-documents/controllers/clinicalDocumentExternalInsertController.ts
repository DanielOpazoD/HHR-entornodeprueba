import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

interface ResolveClinicalDocumentInsertTargetParams {
  document: ClinicalDocumentRecord | null;
  activeEditorSectionId: string | null;
  text: string;
}

interface ClinicalDocumentInsertTarget {
  sectionId: string;
  content: string;
}

export const resolveClinicalDocumentInsertTarget = ({
  document,
  activeEditorSectionId,
  text,
}: ResolveClinicalDocumentInsertTargetParams): ClinicalDocumentInsertTarget | null => {
  if (!document) {
    return null;
  }

  const visibleSections = document.sections.filter(section => section.visible !== false);
  const targetSection =
    visibleSections.find(section => section.id === activeEditorSectionId) ?? visibleSections[0];

  if (!targetSection) {
    return null;
  }

  const existing = targetSection.content || '';
  const separator = existing.trim() ? '<br>' : '';

  return {
    sectionId: targetSection.id,
    content: `${existing}${separator}${text}`,
  };
};
