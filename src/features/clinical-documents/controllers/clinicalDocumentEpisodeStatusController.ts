import type {
  ClinicalDocumentsWorkspacePatientContract,
  ClinicalDocumentsEpisodeClosureKind,
} from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';

import type { UserRole } from '@/types/authRoleTypes';

interface ClinicalDocumentEpisodeClosureState {
  isClosed: boolean;
  closureKind?: ClinicalDocumentsEpisodeClosureKind;
  closureDate?: string;
}

const resolveClinicalDocumentsEpisodeClosureKind = (
  patient: ClinicalDocumentsWorkspacePatientContract
): ClinicalDocumentsEpisodeClosureKind | undefined => {
  if (patient.episodeClosureKind) {
    return patient.episodeClosureKind;
  }

  if (patient.transferDate) {
    return 'transfer';
  }

  if (patient.dischargeDate) {
    return 'discharge';
  }

  return undefined;
};

/**
 * Determines whether the patient's clinical episode is closed and why.
 * @param patient - Patient data including transfer/discharge dates
 * @returns Closure state with kind and date when applicable
 */
export const resolveClinicalDocumentsEpisodeClosure = (
  patient: ClinicalDocumentsWorkspacePatientContract
): ClinicalDocumentEpisodeClosureState => {
  const closureKind = resolveClinicalDocumentsEpisodeClosureKind(patient);
  const closureDate = patient.episodeClosureDate || patient.transferDate || patient.dischargeDate;

  return {
    isClosed: Boolean(closureKind || closureDate),
    closureKind,
    closureDate,
  };
};

/**
 * Returns whether the current user can create or edit documents in this episode.
 * Open episodes allow all roles; closed episodes are restricted to admin.
 * @param patient - Patient data used to derive closure state
 * @param role - Current user's role
 */
export const canMutateClinicalDocumentsEpisode = (
  patient: ClinicalDocumentsWorkspacePatientContract,
  role: UserRole | undefined
): boolean => {
  const closure = resolveClinicalDocumentsEpisodeClosure(patient);
  if (!closure.isClosed) {
    return true;
  }

  return role === 'admin';
};

/**
 * Builds the user-facing read-only banner message, or null if editing is allowed.
 * @param patient - Patient data for episode closure check
 * @param role - Current user's role
 * @param canEditByRole - Whether the user's role permits editing in general
 * @returns Spanish-language message string, or null when no restriction applies
 */
export const buildClinicalDocumentsReadOnlyMessage = (
  patient: ClinicalDocumentsWorkspacePatientContract,
  role: UserRole | undefined,
  canEditByRole: boolean
): string | null => {
  if (!canEditByRole) {
    return 'Perfil en solo lectura: puedes revisar e imprimir, pero no crear nuevos documentos.';
  }

  const closure = resolveClinicalDocumentsEpisodeClosure(patient);
  if (!closure.isClosed || role === 'admin') {
    return null;
  }

  const episodeLabel = closure.closureKind === 'transfer' ? 'traslado' : 'alta';
  return `Episodio cerrado por ${episodeLabel}: solo ADMIN puede crear, editar o eliminar documentos.`;
};

/**
 * Resolves the persistence reason tag for audit logging.
 * Returns 'admin_fix' when an admin saves in a closed episode, otherwise 'autosave'.
 * @param patient - Patient data for episode closure check
 * @param role - Current user's role
 */
export const resolveClinicalDocumentPersistReason = (
  patient: ClinicalDocumentsWorkspacePatientContract,
  role: UserRole | undefined
): 'autosave' | 'admin_fix' => {
  if (role === 'admin' && resolveClinicalDocumentsEpisodeClosure(patient).isClosed) {
    return 'admin_fix';
  }

  return 'autosave';
};
