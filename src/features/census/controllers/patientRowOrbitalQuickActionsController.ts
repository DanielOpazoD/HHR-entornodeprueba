/**
 * Patient Row Orbital Quick Actions Controller
 *
 * Builds the list of topics shown in the orbital launcher (the turtle) beside
 * each patient row. The turtle is the patient's single door: each topic opens
 * a window where the patient's information is read and, when allowed, requested.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which topics are visible for the current patient/context. */
export interface PatientRowOrbitalQuickActionsAvailability {
  showClinicalPanelAction: boolean;
  showLaboratoryAction: boolean;
  showImagingAction: boolean;
  showClinicalDocumentsAction: boolean;
  showClinicalExplorerAction: boolean;
}

/** Icon asset identifiers used by the orbital action items. */
export type PatientRowOrbitalQuickActionAsset =
  | 'manutara'
  | 'mangai'
  | 'ahutepitokura'
  | 'rongorongo'
  | 'rapa';

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
  id: 'clinical-panel' | 'laboratory' | 'imaging' | 'clinical-documents' | 'clinical-explorer';
  label: string;
  tooltip: string;
  iconAsset: PatientRowOrbitalQuickActionAsset;
  buttonClassName: string;
  /** Count displayed as a badge over the action icon. Undefined means no badge. */
  badge?: number;
}

export interface PatientRowOrbitalQuickActionCallbacks {
  onViewClinicalPanel?: () => void;
  onViewLaboratory?: () => void;
  onViewImaging?: () => void;
  onViewClinicalDocuments?: () => void;
  onOpenClinicalExplorer?: () => void;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

type OrbitalActionDefinition = PatientRowOrbitalQuickActionItem & {
  visible: keyof PatientRowOrbitalQuickActionsAvailability;
  dispatch: keyof PatientRowOrbitalQuickActionCallbacks;
};

const ORBITAL_BUTTON_CLASS_NAME = 'bg-white text-slate-700 hover:bg-slate-100';

const ORBITAL_ACTION_DEFINITIONS: OrbitalActionDefinition[] = [
  {
    id: 'clinical-panel',
    label: 'Ficha clínica',
    tooltip: 'Ficha clínica: evoluciones, indicaciones y cuidados',
    iconAsset: 'manutara',
    buttonClassName: ORBITAL_BUTTON_CLASS_NAME,
    visible: 'showClinicalPanelAction',
    dispatch: 'onViewClinicalPanel',
  },
  {
    id: 'laboratory',
    label: 'Laboratorio',
    tooltip: 'Laboratorio: resultados y solicitud de exámenes',
    iconAsset: 'mangai',
    buttonClassName: ORBITAL_BUTTON_CLASS_NAME,
    visible: 'showLaboratoryAction',
    dispatch: 'onViewLaboratory',
  },
  {
    id: 'imaging',
    label: 'Imágenes',
    tooltip: 'Imágenes: estudios y solicitud de imágenes',
    iconAsset: 'ahutepitokura',
    buttonClassName: ORBITAL_BUTTON_CLASS_NAME,
    visible: 'showImagingAction',
    dispatch: 'onViewImaging',
  },
  {
    id: 'clinical-documents',
    label: 'Documentos',
    tooltip: 'Documentos clínicos',
    iconAsset: 'rongorongo',
    buttonClassName: ORBITAL_BUTTON_CLASS_NAME,
    visible: 'showClinicalDocumentsAction',
    dispatch: 'onViewClinicalDocuments',
  },
  {
    id: 'clinical-explorer',
    label: 'Vista integrada',
    tooltip: 'Vista integrada del paciente: evoluciones, signos, laboratorio e imágenes',
    iconAsset: 'rapa',
    buttonClassName: ORBITAL_BUTTON_CLASS_NAME,
    visible: 'showClinicalExplorerAction',
    dispatch: 'onOpenClinicalExplorer',
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
    ({ visible: _visible, dispatch: _dispatch, ...item }) => ({
      ...item,
      badge: resolveActionBadge(item.id, badges),
    })
  );

/**
 * Returns true if at least one orbital quick action is available.
 */
export const hasPatientRowOrbitalQuickActions = (
  availability: PatientRowOrbitalQuickActionsAvailability
): boolean => ORBITAL_ACTION_DEFINITIONS.some(def => availability[def.visible]);

export const dispatchPatientRowOrbitalQuickAction = (
  itemId: PatientRowOrbitalQuickActionItem['id'],
  callbacks: PatientRowOrbitalQuickActionCallbacks
): void => {
  const definition = ORBITAL_ACTION_DEFINITIONS.find(def => def.id === itemId);
  if (definition) callbacks[definition.dispatch]?.();
};
