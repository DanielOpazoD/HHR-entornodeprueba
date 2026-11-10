import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

/**
 * Moves a visible section to the position of another via drag-and-drop reorder.
 * Hidden sections retain their relative order after the visible ones.
 * @param sections - Current sections array
 * @param sourceSectionId - ID of the section being moved
 * @param targetSectionId - ID of the section to insert before/at
 * @returns New sections array with updated order values
 */
export const reorderClinicalDocumentVisibleSections = (
  sections: ClinicalDocumentRecord['sections'],
  sourceSectionId: string,
  targetSectionId: string
): ClinicalDocumentRecord['sections'] => {
  if (sourceSectionId === targetSectionId) {
    return sections;
  }

  const orderedSections = [...sections].sort((left, right) => left.order - right.order);
  const visibleSections = orderedSections.filter(section => section.visible !== false);
  const hiddenSections = orderedSections.filter(section => section.visible === false);
  const sourceIndex = visibleSections.findIndex(section => section.id === sourceSectionId);
  const targetIndex = visibleSections.findIndex(section => section.id === targetSectionId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return sections;
  }

  const reorderedVisibleSections = [...visibleSections];
  const [movedSection] = reorderedVisibleSections.splice(sourceIndex, 1);
  reorderedVisibleSections.splice(targetIndex, 0, movedSection);

  const nextVisibleSections = reorderedVisibleSections.map((section, index) => ({
    ...section,
    order: index,
  }));
  const nextHiddenSections = hiddenSections.map((section, index) => ({
    ...section,
    order: nextVisibleSections.length + index,
  }));
  const nextSectionMap = new Map(
    [...nextVisibleSections, ...nextHiddenSections].map(section => [section.id, section])
  );

  return sections
    .map(section => nextSectionMap.get(section.id) || section)
    .sort((left, right) => left.order - right.order);
};

/**
 * Inserts a new blank section above or below a reference section.
 * @param sections - Current sections array
 * @param referenceSectionId - ID of the section to insert relative to
 * @param position - Whether to insert 'above' or 'below' the reference
 * @returns Updated sections array including the new section
 */
export const insertClinicalDocumentSection = (
  sections: ClinicalDocumentRecord['sections'],
  referenceSectionId: string,
  position: 'above' | 'below'
): ClinicalDocumentRecord['sections'] => {
  const orderedSections = [...sections].sort((left, right) => left.order - right.order);
  const visibleSections = orderedSections.filter(section => section.visible !== false);
  const refIndex = visibleSections.findIndex(section => section.id === referenceSectionId);
  if (refIndex === -1) return sections;

  const newSection: ClinicalDocumentRecord['sections'][number] = {
    id: `custom-${Date.now()}`,
    title: 'Nueva sección',
    content: '',
    kind: 'standard',
    order: 0,
    visible: true,
  };

  const insertIndex = position === 'above' ? refIndex : refIndex + 1;
  const nextVisible = [...visibleSections];
  nextVisible.splice(insertIndex, 0, newSection);

  const hiddenSections = orderedSections.filter(section => section.visible === false);
  const reorderedVisible = nextVisible.map((section, index) => ({ ...section, order: index }));
  const reorderedHidden = hiddenSections.map((section, index) => ({
    ...section,
    order: reorderedVisible.length + index,
  }));

  return [...reorderedVisible, ...reorderedHidden];
};

/**
 * Moves a visible section one position up or down among visible sections.
 * @param sections - Current sections array
 * @param sectionId - ID of the section to move
 * @param direction - 'up' or 'down'
 * @returns Reordered sections array, or the original if the move is out of bounds
 */
export const moveClinicalDocumentVisibleSection = (
  sections: ClinicalDocumentRecord['sections'],
  sectionId: string,
  direction: 'up' | 'down'
): ClinicalDocumentRecord['sections'] => {
  const visibleOrdered = [...sections]
    .filter(section => section.visible !== false)
    .sort((left, right) => left.order - right.order);
  const currentVisibleIndex = visibleOrdered.findIndex(section => section.id === sectionId);
  if (currentVisibleIndex === -1) {
    return sections;
  }

  const targetVisibleIndex = direction === 'up' ? currentVisibleIndex - 1 : currentVisibleIndex + 1;
  if (targetVisibleIndex < 0 || targetVisibleIndex >= visibleOrdered.length) {
    return sections;
  }

  const targetSection = visibleOrdered[targetVisibleIndex];
  if (!targetSection) {
    return sections;
  }

  return reorderClinicalDocumentVisibleSections(sections, sectionId, targetSection.id);
};
