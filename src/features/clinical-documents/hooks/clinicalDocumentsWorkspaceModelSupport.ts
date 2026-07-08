import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import {
  buildClinicalDocumentsReadOnlyMessage,
  canMutateClinicalDocumentsEpisode,
  resolveClinicalDocumentPersistReason,
} from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeStatusController';
import {
  canDeleteClinicalDocuments,
  canEditClinicalDocuments,
  canReadClinicalDocuments,
} from '@/features/clinical-documents/controllers/clinicalDocumentPermissionController';
import type { UserRole } from '@/types/authRoleTypes';

export interface ClinicalDocumentsWorkspaceAccessState {
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canDeleteByRole: boolean;
  canMutateEpisode: boolean;
  readOnlyMessage: string | null;
  persistReason: 'autosave' | 'admin_fix';
}

export const resolveClinicalDocumentsWorkspaceAccessState = (
  patient: PatientData,
  role: UserRole | undefined
): ClinicalDocumentsWorkspaceAccessState => {
  const canRead = canReadClinicalDocuments(role);
  const canEditByRole = canEditClinicalDocuments(role);
  const canDeleteByRole = canDeleteClinicalDocuments(role);
  const canMutateEpisode = canMutateClinicalDocumentsEpisode(patient, role);

  return {
    canRead,
    canEdit: canEditByRole && canMutateEpisode,
    canDelete: canDeleteByRole && canMutateEpisode,
    canDeleteByRole,
    canMutateEpisode,
    readOnlyMessage: buildClinicalDocumentsReadOnlyMessage(patient, role, canEditByRole),
    persistReason: resolveClinicalDocumentPersistReason(patient, role),
  };
};

interface ClinicalDocumentDeleteWorkspaceUser {
  uid?: string | null;
  email?: string | null;
}

const normalizeActorIdentity = (value: string | null | undefined): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const isClinicalDocumentAuthor = (
  document: ClinicalDocumentRecord,
  user: ClinicalDocumentDeleteWorkspaceUser | null | undefined
): boolean => {
  if (!user) return false;

  const author = document.audit.createdBy;
  const userUid = normalizeActorIdentity(user.uid);
  const authorUid = normalizeActorIdentity(author.uid);
  if (userUid && authorUid && userUid === authorUid) {
    return true;
  }

  const userEmail = normalizeActorIdentity(user.email);
  const authorEmail = normalizeActorIdentity(author.email);
  return Boolean(userEmail && authorEmail && userEmail === authorEmail);
};

const canMedicalRoleDeleteOwnActiveDocument = (role: UserRole | undefined): boolean =>
  canEditClinicalDocuments(role);

export const canDeleteClinicalDocumentFromWorkspace = ({
  document,
  canDeleteByRole,
  canMutateEpisode,
  role,
  user,
}: {
  document: ClinicalDocumentRecord;
  canDeleteByRole: boolean;
  canMutateEpisode: boolean;
  role: UserRole | undefined;
  user: ClinicalDocumentDeleteWorkspaceUser | null | undefined;
}): boolean => {
  if (!canMutateEpisode) {
    return false;
  }

  if (canDeleteByRole) {
    return true;
  }

  return (
    canMedicalRoleDeleteOwnActiveDocument(role) &&
    document.isActiveEpisodeDocument &&
    !document.isLocked &&
    isClinicalDocumentAuthor(document, user)
  );
};

export const mergeDraftIntoClinicalDocumentsSidebar = (
  documents: ClinicalDocumentRecord[],
  draft: ClinicalDocumentRecord | null
): ClinicalDocumentRecord[] =>
  draft ? documents.map(document => (document.id === draft.id ? draft : document)) : documents;

export const canApplyClinicalDocumentTemplateSelection = ({
  draft,
  canEdit,
}: {
  draft: ClinicalDocumentRecord | null;
  canEdit: boolean;
}): boolean => Boolean(draft && canEdit && !draft.isLocked);

export const buildRestoreClinicalDocumentTemplateConfirmOptions = () => ({
  title: 'Reestablecer plantilla del documento',
  message:
    'Se restaurarán el título, las etiquetas y las secciones base de la plantilla. El contenido clínico editable actual se reemplazará por la estructura original del documento.',
  confirmText: 'Reestablecer',
  cancelText: 'Cancelar',
  variant: 'warning' as const,
});
