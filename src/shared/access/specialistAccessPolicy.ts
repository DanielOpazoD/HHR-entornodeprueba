import type { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/types/authRoleTypes';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import { resolveRoleAccess } from '@/shared/access/roleAccessMatrix';
import { normalizeDateOnly, resolveCurrentClinicalDay } from '@/utils/clinicalDayUtils';

type SupportedRole = UserRole | string | undefined;
export const SPECIALIST_VISIBLE_MODULES: ModuleType[] = ['CENSUS', 'MEDICAL_HANDOFF'];
export const SPECIALIST_EDITABLE_MODULES: ModuleType[] = ['MEDICAL_HANDOFF'];

export interface SpecialistCapabilities {
  isSpecialist: boolean;
  visibleModules: ModuleType[];
  editableModules: ModuleType[];
  censusAccessProfile: CensusAccessProfile;
  hasRestrictedMedicalAccess: boolean;
  canReadClinicalDocuments: boolean;
  canEditClinicalDocumentDrafts: boolean;
}

export const resolveSpecialistCapabilities = (role: SupportedRole): SpecialistCapabilities => {
  const roleAccess = resolveRoleAccess(role);
  const isSpecialist = roleAccess.specialistRestrictedMedicalAccess;

  return {
    isSpecialist,
    visibleModules: isSpecialist ? SPECIALIST_VISIBLE_MODULES : [],
    editableModules: isSpecialist ? SPECIALIST_EDITABLE_MODULES : [],
    censusAccessProfile: roleAccess.censusAccessProfile,
    hasRestrictedMedicalAccess: roleAccess.specialistRestrictedMedicalAccess,
    canReadClinicalDocuments: isSpecialist,
    canEditClinicalDocumentDrafts: isSpecialist,
  };
};

export const resolveSpecialistCensusAccessProfile = (role: SupportedRole): CensusAccessProfile =>
  resolveSpecialistCapabilities(role).censusAccessProfile;

export const hasSpecialistRestrictedMedicalAccess = (role: SupportedRole): boolean =>
  resolveSpecialistCapabilities(role).hasRestrictedMedicalAccess;

export const canEditSpecialistTodayBoundRecord = ({
  role,
  readOnly,
  recordDate,
  todayISO = resolveCurrentClinicalDay(),
}: {
  role: SupportedRole;
  readOnly: boolean;
  recordDate?: string;
  todayISO?: string;
}): boolean => {
  if (readOnly) {
    return false;
  }

  if (!hasSpecialistRestrictedMedicalAccess(role)) {
    return true;
  }

  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedTodayISO = normalizeDateOnly(todayISO);

  return Boolean(
    normalizedRecordDate && normalizedTodayISO && normalizedRecordDate === normalizedTodayISO
  );
};
