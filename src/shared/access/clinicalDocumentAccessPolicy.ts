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
