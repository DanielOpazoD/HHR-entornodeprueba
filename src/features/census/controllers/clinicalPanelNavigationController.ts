export type ClinicalPanelNavigationDirection = 'previous' | 'next';

/** One panel per bed and episode; a crib shares its bed but not its episode. */
export const buildClinicalPanelKey = (bedId: string, episodeId: string): string =>
  `${bedId}:${episodeId.trim()}`;

export interface ClinicalPanelNavigationState {
  previous: string | null;
  next: string | null;
}

// A crib keeps a visible button; a main row keeps only a marker beside its turtle.
const isClinicalPanelEntry = (element: Element): element is HTMLElement =>
  element instanceof HTMLElement &&
  !element.hidden &&
  !(element instanceof HTMLButtonElement && element.disabled);

/** Resolve the panel keys before and after `currentKey`, in census table order. */
export const resolveClinicalPanelNavigation = (
  root: ParentNode,
  currentKey: string
): ClinicalPanelNavigationState => {
  const keys = [...root.querySelectorAll('[data-clinical-panel-key]')]
    .filter(isClinicalPanelEntry)
    .map(entry => entry.dataset.clinicalPanelKey ?? '');
  const currentIndex = keys.indexOf(currentKey);

  if (currentIndex < 0) return { previous: null, next: null };
  return {
    previous: currentIndex > 0 ? keys[currentIndex - 1] : null,
    next: currentIndex < keys.length - 1 ? keys[currentIndex + 1] : null,
  };
};
