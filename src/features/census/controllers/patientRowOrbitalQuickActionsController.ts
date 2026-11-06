/**
 * Patient Row Orbital Quick Actions Controller
 *
 * Builds the list of quick-action items shown in the orbital launcher
 * beside each patient row. Controls visibility per action and assigns
 * badge counts (e.g., clinical document count) to each item.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which orbital actions are visible for the current patient/context. */
export interface PatientRowOrbitalQuickActionsAvailability {
  showClinicalDocumentsAction: boolean;
  showExamRequestAction: boolean;
  showImagingRequestAction: boolean;
}

/** Icon asset identifiers used by the orbital action items. */
export type PatientRowOrbitalQuickActionAsset = 'rongorongo' | 'mangai' | 'ahutepitokura';

/**
 * Badge counts passed from the census table to the orbital launcher.
 * Each field corresponds to a specific action item.
 */
export interface PatientRowOrbitalQuickActionBadges {
  /** Number of active clinical documents for the patient's current episode. */
  clinicalDocumentCount?: number;
}

/** A single action item rendered in the orbital launcher. */
export interface PatientRowOrbitalQuickActionItem {
  id: 'clinical-documents' | 'exam-request' | 'imaging-request';
  label: string;
  tooltip: string;
  iconAsset: PatientRowOrbitalQuickActionAsset;
  buttonClassName: string;
  /** Count displayed as a badge over the action icon. Undefined means no badge. */
  badge?: number;
}

export interface PatientRowOrbitalQuickActionCallbacks {
  onViewClinicalDocuments?: () => void;
  onViewExamRequest?: () => void;
  onViewImagingRequest?: () => void;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

type OrbitalActionDefinition = PatientRowOrbitalQuickActionItem & {
  visible: keyof PatientRowOrbitalQuickActionsAvailability;
};

const ORBITAL_ACTION_DEFINITIONS: OrbitalActionDefinition[] = [
  {
    id: 'clinical-documents',
    label: 'Documentos',
    tooltip: 'Documentos clínicos',
    iconAsset: 'rongorongo',
    buttonClassName: 'bg-white text-slate-700 hover:bg-slate-100',
    visible: 'showClinicalDocumentsAction',
  },
  {
    id: 'exam-request',
    label: 'Laboratorio',
    tooltip: 'Solicitud Exámenes',
    iconAsset: 'mangai',
    buttonClassName: 'bg-white text-slate-700 hover:bg-slate-100',
    visible: 'showExamRequestAction',
  },
  {
    id: 'imaging-request',
    label: 'Imágenes',
    tooltip: 'Solicitud de Imágenes',
    iconAsset: 'ahutepitokura',
    buttonClassName: 'bg-white text-slate-700 hover:bg-slate-100',
    visible: 'showImagingRequestAction',
  },
];

// ---------------------------------------------------------------------------
// Badge resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the badge value for a given action item based on its ID.
 * Only `clinical-documents` currently supports badges.
 */
const resolveActionBadge = (
  actionId: PatientRowOrbitalQuickActionItem['id'],
  badges?: PatientRowOrbitalQuickActionBadges
): number | undefined => {
  if (actionId === 'clinical-documents' && badges?.clinicalDocumentCount) {
    return badges.clinicalDocumentCount;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Builds the list of visible orbital action items with badge values.
 *
 * @param availability - Which actions are visible
 * @param badges - Optional badge counts per action type
 * @returns Ordered list of action items for the orbital launcher
 */
export const buildPatientRowOrbitalQuickActionItems = (
  availability: PatientRowOrbitalQuickActionsAvailability,
  badges?: PatientRowOrbitalQuickActionBadges
): PatientRowOrbitalQuickActionItem[] =>
  ORBITAL_ACTION_DEFINITIONS.filter(def => availability[def.visible]).map(
    ({ visible: _visible, ...item }) => ({
      ...item,
      badge: resolveActionBadge(item.id, badges),
    })
  );

/**
 * Returns true if at least one orbital quick action is available.
 */
export const hasPatientRowOrbitalQuickActions = (
  availability: PatientRowOrbitalQuickActionsAvailability
): boolean =>
  availability.showClinicalDocumentsAction ||
  availability.showExamRequestAction ||
  availability.showImagingRequestAction;

export const dispatchPatientRowOrbitalQuickAction = (
  itemId: PatientRowOrbitalQuickActionItem['id'],
  callbacks: PatientRowOrbitalQuickActionCallbacks
): void => {
  if (itemId === 'clinical-documents') {
    callbacks.onViewClinicalDocuments?.();
    return;
  }

  if (itemId === 'exam-request') {
    callbacks.onViewExamRequest?.();
    return;
  }

  if (itemId === 'imaging-request') {
    callbacks.onViewImagingRequest?.();
    return;
  }
};
