export type ClinicalPanelNavigationDirection = 'previous' | 'next';

export interface ClinicalPanelNavigationState {
  previous: HTMLButtonElement | null;
  next: HTMLButtonElement | null;
}

const isClinicalPanelTrigger = (element: Element): element is HTMLButtonElement =>
  element instanceof HTMLButtonElement && !element.disabled && !element.hidden;

/** Resolve adjacent patient-panel triggers in the same visual order as the census table. */
export const resolveClinicalPanelNavigation = (
  root: ParentNode,
  currentKey: string
): ClinicalPanelNavigationState => {
  const triggers = [...root.querySelectorAll('[data-clinical-panel-key]')].filter(
    isClinicalPanelTrigger
  );
  const currentIndex = triggers.findIndex(
    trigger => trigger.dataset.clinicalPanelKey === currentKey
  );

  if (currentIndex < 0) return { previous: null, next: null };
  return {
    previous: currentIndex > 0 ? triggers[currentIndex - 1] : null,
    next: currentIndex < triggers.length - 1 ? triggers[currentIndex + 1] : null,
  };
};
