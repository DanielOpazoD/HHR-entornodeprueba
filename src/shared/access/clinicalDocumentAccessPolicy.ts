import type { UserRole } from '@/types/authRoleTypes';
import { resolveSpecialistCapabilities } from '@/shared/access/specialistAccessPolicy';

export const canReadClinicalDocuments = (role: UserRole | undefined): boolean =>
  role === 'admin' ||
  role === 'doctor_urgency' ||
  resolveSpecialistCapabilities(role).canReadClinicalDocuments ||
  role === 'nurse_hospital' ||
  role === 'editor';

export const canEditClinicalDocuments = (role: UserRole | undefined): boolean =>
  role === 'admin' ||
  role === 'doctor_urgency' ||
  resolveSpecialistCapabilities(role).canEditClinicalDocumentDrafts;

export const canArchiveClinicalDocuments = (role: UserRole | undefined): boolean =>
  role === 'admin';

export const canDeleteClinicalDocuments = (role: UserRole | undefined): boolean => role === 'admin';

/** Documents of a closed episode stay editable only for the administrator (an audited fix). */
export const canEditClosedEpisodeDocuments = (role: UserRole | undefined): boolean =>
  role === 'admin';
