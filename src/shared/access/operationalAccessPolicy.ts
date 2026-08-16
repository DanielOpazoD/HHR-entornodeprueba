import type { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/types/authRoleTypes';
import {
  ACTIONS,
  canDoAction,
  canEditModule,
  getRoleDisplayName,
  getVisibleModules,
  isAdmin,
} from '@/utils/permissions';
import { canReadClinicalDocuments } from '@/application/clinical-documents/clinicalDocumentAccessPolicy';
import {
  isSpecialistCensusAccessProfile,
  type CensusAccessProfile,
} from '@/shared/access/censusAccessProfile';
import {
  canAccessSpecialAppModuleRoute,
  resolvePassiveBackupEditableModule,
} from '@/shared/access/operationalAccessPolicySupport';
import { canEditSpecialistTodayBoundRecord } from '@/shared/access/specialistAccessPolicy';
import { getPreviousDay, normalizeDateOnly } from '@/utils/clinicalDayUtils';

type SupportedRole = UserRole | string | undefined;

export const getVisibleAppModules = (role: SupportedRole): ModuleType[] =>
  getVisibleModules((typeof role === 'string' ? role : undefined) as UserRole | undefined);

export const getDefaultAppModuleForRole = (role: SupportedRole): ModuleType =>
  getVisibleAppModules(role)[0] || 'CENSUS';

export const sanitizeAppModuleForRole = (role: SupportedRole, module: ModuleType): ModuleType => {
  const visibleModules = getVisibleAppModules(role);
  return visibleModules.includes(module) ? module : getDefaultAppModuleForRole(role);
};

export const canEditAppModule = (role: SupportedRole, module: ModuleType): boolean =>
  canEditModule((typeof role === 'string' ? role : undefined) as UserRole | undefined, module);

export const canEditAnyAppModule = (role: SupportedRole): boolean =>
  getVisibleAppModules(role).some(module => canEditAppModule(role, module));

export const canForceCreateDayCopyOverride = (role: SupportedRole): boolean => isAdmin(role);

export const canVerifyPassiveBackupForRole = (
  role: SupportedRole,
  moduleType: ModuleType | string
): boolean => {
  const editableModule = resolvePassiveBackupEditableModule(moduleType);
  return editableModule ? canEditAppModule(role, editableModule) : false;
};

export const canViewOrManageBackupFiles = (role: SupportedRole): boolean =>
  canEditAppModule(role, 'NURSING_HANDOFF');

export const canAccessAppModuleRoute = ({
  role,
  module,
  visibleModules,
}: {
  role: SupportedRole;
  module: ModuleType;
  visibleModules?: readonly ModuleType[];
}): boolean => {
  const resolvedVisibleModules = visibleModules || getVisibleAppModules(role);
  if (!resolvedVisibleModules.includes(module)) {
    return false;
  }

  const specialAccess = canAccessSpecialAppModuleRoute({
    module,
    isAuditAllowed: canAccessAuditViewForRole(role),
    canManageBackupFiles: canViewOrManageBackupFiles(role),
    canUseAdminMaintenance: canUseAdminMaintenanceActions(role),
    allowRoleManagementBootstrap: role === undefined,
  });

  return specialAccess ?? true;
};

export const canManageGlobalCensusEmailRecipients = ({
  role,
  userId,
}: {
  role: SupportedRole;
  userId?: string | null;
}): boolean => Boolean(userId) && (isAdmin(role) || role === 'nurse_hospital' || role === 'editor');

export const canUseAdminMaintenanceActions = (role: SupportedRole): boolean => isAdmin(role);

export const canTriggerCensusExports = ({
  role,
  accessProfile = 'default',
}: {
  role: SupportedRole;
  accessProfile?: CensusAccessProfile;
}): boolean => canEditAppModule(role, 'CENSUS') && !isSpecialistCensusAccessProfile(accessProfile);

export const canViewPatientHistoryFromRestrictedProfiles = ({
  accessProfile = 'default',
  hasRut,
}: {
  accessProfile?: CensusAccessProfile;
  hasRut: boolean;
}): boolean => !isSpecialistCensusAccessProfile(accessProfile) && hasRut;

export const canVerifyArchiveStatusForModule = (
  role: SupportedRole,
  moduleType: ModuleType | string
): boolean => canVerifyPassiveBackupForRole(role, moduleType);

export const canEditMedicalHandoffForDate = ({
  role,
  readOnly,
  recordDate,
  todayISO,
}: {
  role: SupportedRole;
  readOnly: boolean;
  recordDate?: string;
  todayISO?: string;
}): boolean =>
  canEditSpecialistTodayBoundRecord({
    role,
    readOnly,
    recordDate,
    todayISO,
  });

export const canEditCudyrForDate = ({
  role,
  readOnly,
  recordDate,
  todayISO,
}: {
  role: SupportedRole;
  readOnly: boolean;
  recordDate?: string;
  todayISO?: string;
}): boolean => {
  if (readOnly) {
    return false;
  }

  if (role === 'admin') {
    return true;
  }

  if (!canDoAction(role, ACTIONS.CUDYR_EDIT)) {
    return false;
  }

  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedTodayISO = normalizeDateOnly(todayISO);
  if (!normalizedRecordDate || !normalizedTodayISO) {
    return false;
  }

  return (
    normalizedRecordDate === normalizedTodayISO ||
    normalizedRecordDate === getPreviousDay(normalizedTodayISO)
  );
};

export const canOpenClinicalDocumentsFromCensus = ({
  role,
  isBlocked,
  isEmpty,
  hasPatientName,
}: {
  role: SupportedRole;
  isBlocked: boolean;
  isEmpty: boolean;
  hasPatientName: boolean;
}): boolean =>
  !isBlocked &&
  !isEmpty &&
  hasPatientName &&
  canReadClinicalDocuments((typeof role === 'string' ? role : undefined) as UserRole | undefined);

export const canUseCensusUtilityActions = ({
  readOnly,
  accessProfile = 'default',
}: {
  readOnly: boolean;
  accessProfile?: CensusAccessProfile;
}): boolean => !readOnly && !isSpecialistCensusAccessProfile(accessProfile);

export const canResetOrDeleteDailyRecord = ({
  role,
  isToday,
}: {
  role: SupportedRole;
  isToday: boolean;
}): boolean => {
  if (isAdmin(role)) {
    return true;
  }

  if (!isToday) {
    return false;
  }

  return canDoAction(role, ACTIONS.RECORD_DELETE);
};

export const canDeleteTodayDailyRecord = (role: SupportedRole): boolean =>
  canDoAction(role, ACTIONS.RECORD_DELETE);

export const isAdminAppRole = (role: SupportedRole): boolean => isAdmin(role);

export const canManageAllMedicalSpecialties = (role: SupportedRole): boolean =>
  canEditAppModule(role, 'MEDICAL_HANDOFF');

export const canAccessAuditViewForRole = (role: SupportedRole): boolean =>
  getVisibleAppModules(role).includes('AUDIT') && canDoAction(role, ACTIONS.AUDIT_READ);

export const canAccessAuditSensitivePanelsForRole = (role: SupportedRole): boolean => isAdmin(role);

export const canManageClinicalConflictCenter = (role: SupportedRole): boolean => isAdmin(role);

export const canExportAuditDataForRole = (role: SupportedRole): boolean =>
  canDoAction(role, ACTIONS.EXPORT_EXCEL) || canDoAction(role, ACTIONS.EXPORT_PDF);

export const canSignMedicalHandoff = ({
  role,
  readOnly,
  specialistRestrictedAccess,
}: {
  role: SupportedRole;
  readOnly: boolean;
  specialistRestrictedAccess: boolean;
}): boolean =>
  !specialistRestrictedAccess && !readOnly && canDoAction(role, ACTIONS.HANDOFF_MEDICAL_SIGN);

export const canSendMedicalHandoffWhatsApp = ({
  role,
  readOnly,
  specialistRestrictedAccess,
}: {
  role: SupportedRole;
  readOnly: boolean;
  specialistRestrictedAccess: boolean;
}): boolean =>
  !specialistRestrictedAccess && !readOnly && canDoAction(role, ACTIONS.HANDOFF_SEND_WHATSAPP);

export const getRoleDisplayLabel = (role?: UserRole): string => getRoleDisplayName(role);
