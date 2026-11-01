import type {
  ClinicalDocumentEpisodeContext,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/domain/entities';
import type { ConfirmOptions } from '@/context/uiContracts';
import { getClinicalDocumentDefinition } from '@/features/clinical-documents/domain/definitions';
import { hydrateClinicalDocumentRecord } from '@/application/ports/clinicalDocumentCompatibilityPort';
import { formatClinicalDocumentDateTime as formatClinicalDocumentDateTimePresentation } from '@/shared/clinical-documents/clinicalDocumentPresentation';

/** Serializes a clinical document record to JSON, returning empty string for null. */
export const serializeClinicalDocument = (record: ClinicalDocumentRecord | null): string =>
  record ? JSON.stringify(record) : '';

/** Hydrates a persisted document record, filling missing compatibility defaults. */
export const hydrateClinicalDocumentWorkspaceRecord = (
  record: ClinicalDocumentRecord
): ClinicalDocumentRecord => hydrateClinicalDocumentRecord(record);

/** Formats an ISO date string for display in the clinical document UI. */
export const formatClinicalDocumentDateTime = (isoString?: string): string => {
  return formatClinicalDocumentDateTimePresentation(isoString);
};

/** Returns the CSS grid class names for a patient field cell by field ID. */
export const getClinicalDocumentPatientFieldGridClass = (fieldId: string): string =>
  `clinical-document-patient-field stacked clinical-document-patient-field--${fieldId}`;

/**
 * Formats a user display name into a short author label (first name + first surname).
 * @param value - Raw display name or email
 * @returns Shortened author name, or 'Usuario' if empty
 */
export const formatClinicalDocumentAuthorName = (value?: string | null): string => {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Usuario';
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0];
  }

  if (tokens.length === 2) {
    return `${tokens[0]} ${tokens[1]}`;
  }

  return `${tokens[0]} ${tokens[tokens.length - 2]}`;
};

/** Resolves the display label for a patient field, applying definition overrides if present. */
export const getClinicalDocumentPatientFieldLabel = (
  field: ClinicalDocumentRecord['patientFields'][number],
  documentType: ClinicalDocumentRecord['documentType']
): string => {
  const definition = getClinicalDocumentDefinition(documentType);
  return definition.resolvePatientFieldLabel?.(field) || field.label;
};

/** Auto-resizes a section textarea to fit its content, enforcing a minimum height. */
export const resizeClinicalDocumentSectionTextarea = (
  textarea: HTMLTextAreaElement | null
): void => {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const minHeight = 92;
  textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
};

/**
 * Builds an audit actor object from the current Firebase user and their role.
 * @param user - Firebase auth user (uid, email, displayName)
 * @param role - User role within the workspace
 * @returns Normalized actor with formatted display name
 */
export const buildClinicalDocumentActor = (
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  } | null,
  role: string | null | undefined
) => ({
  uid: user?.uid || '',
  email: user?.email || '',
  displayName: formatClinicalDocumentAuthorName(user?.displayName || user?.email || 'Usuario'),
  role: role || 'viewer',
});

/** Assembles the notification port (success, warning, error, info, confirm) for workspace actions. */
export const buildClinicalDocumentWorkspaceNotifyPort = (
  success: (title: string, message?: string) => void,
  warning: (title: string, message?: string) => void,
  notifyError: (title: string, message?: string) => void,
  info: (title: string, message?: string) => void,
  confirm: (options: ConfirmOptions) => Promise<boolean>
) => ({
  success,
  warning,
  error: notifyError,
  info,
  confirm,
});

/** Alias for the episode context used by the clinical document workspace. */
export type ClinicalDocumentWorkspaceEpisode = ClinicalDocumentEpisodeContext;
