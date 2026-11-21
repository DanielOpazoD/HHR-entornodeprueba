import type { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/types/authRoleTypes';
import {
  ACTIONS,
  canDoAction,
  canEditModule,
  getRoleDisplayName,
  getVisibleModules,
  isAdmin,
} from '@/shared/access/rolePermissions';
import { canReadClinicalDocuments } from '@/shared/access/clinicalDocumentAccessPolicy';
import {
  isSpecialistCensusAccessProfile,
  type CensusAccessProfile,
} from '@/shared/access/censusAccessProfile';
import { isUserRole } from '@/shared/access/roleAccessMatrix';
import {
  canAccessSpecialAppModuleRoute,
  resolvePassiveBackupEditableModule,
} from '@/shared/access/operationalAccessPolicySupport';
import { getPreviousDay, normalizeDateOnly } from '@/utils/clinicalDayUtils';

/** The role as callers hold it, possibly free text from a stored profile. */
type SupportedRole = string | undefined;

/** Free text that is not a domain role carries no access of its own: it gets the default, like no role. */
const knownRole = (role: SupportedRole): UserRole | undefined =>
  isUserRole(role) ? role : undefined;

export const getVisibleAppModules = (role: SupportedRole): ModuleType[] =>
  getVisibleModules(knownRole(role));

export const getDefaultAppModuleForRole = (role: SupportedRole): ModuleType =>
  getVisibleAppModules(role)[0] || 'CENSUS';

export const sanitizeAppModuleForRole = (role: SupportedRole, module: ModuleType): ModuleType => {
  const visibleModules = getVisibleAppModules(role);
  return visibleModules.includes(module) ? module : getDefaultAppModuleForRole(role);
};

export const canEditAppModule = (role: SupportedRole, module: ModuleType): boolean =>
  canEditModule(knownRole(role), module);

export const canEditAnyAppModule = (role: SupportedRole): boolean =>
  getVisibleAppModules(role).some(module => canEditAppModule(role, module));

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
}): boolean =>
  Boolean(userId) && (isAdmin(knownRole(role)) || role === 'nurse_hospital' || role === 'editor');

export const canUseAdminMaintenanceActions = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));

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

  if (!canDoAction(knownRole(role), ACTIONS.CUDYR_EDIT)) {
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

/** Actual departure is an audited statistical correction; it does not edit the historical census. */
export const canCorrectCudyrDischarge = ({
  role,
  readOnly,
}: {
  role: SupportedRole;
  readOnly: boolean;
}): boolean => !readOnly && (role === 'admin' || role === 'nurse_hospital');

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
  !isBlocked && !isEmpty && hasPatientName && canReadClinicalDocuments(knownRole(role));

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
  if (isAdmin(knownRole(role))) {
    return true;
  }

  if (!isToday) {
    return false;
  }

  return canDoAction(knownRole(role), ACTIONS.RECORD_DELETE);
};

export const canDeleteTodayDailyRecord = (role: SupportedRole): boolean =>
  canDoAction(knownRole(role), ACTIONS.RECORD_DELETE);

export const isAdminAppRole = (role: SupportedRole): boolean => isAdmin(knownRole(role));

export const canAccessAuditViewForRole = (role: SupportedRole): boolean =>
  getVisibleAppModules(role).includes('AUDIT') && canDoAction(knownRole(role), ACTIONS.AUDIT_READ);

export const canAccessAuditSensitivePanelsForRole = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));

export const canManageClinicalConflictCenter = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));

export const canExportAuditDataForRole = (role: SupportedRole): boolean =>
  canDoAction(knownRole(role), ACTIONS.EXPORT_EXCEL) ||
  canDoAction(knownRole(role), ACTIONS.EXPORT_PDF);

export const getRoleDisplayLabel = (role?: UserRole): string => getRoleDisplayName(role);

/**
 * Functions telemetry is strictly admin-only: it can carry error messages, request context and
 * external service failure signatures, operational detail that non-admins must not see.
 */
export const canAccessFunctionsTelemetryView = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));

/**
 * An admin view that renders while the role is still loading: only a role known not to be admin
 * is turned away (role management and reminders).
 */
export const mayBeAdminRole = (role: SupportedRole): boolean =>
  role === undefined || isAdminAppRole(role);

/** The ward's own tools: the administrator and hospital nursing. */
const isAdminOrHospitalNurse = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role)) || role === 'nurse_hospital';

export const canUseBookmarks = (role: SupportedRole): boolean => isAdminOrHospitalNurse(role);

export const canReportSystemHealth = (role: SupportedRole): boolean => isAdminOrHospitalNurse(role);

export const canConnectNursingHandoff = (role: SupportedRole): boolean =>
  isAdminOrHospitalNurse(role);

/** Day actions (bookmarks, PDF, handoff) are hidden only from the read-only guest. */
export const canUseDayActions = (role: SupportedRole): boolean => role !== 'viewer';

/**
 * The prescription visor: whoever edits some module sees it and edits its prescriptions, the
 * legacy editor and the specialist included.
 */
export const canViewPrescriptions = (role: SupportedRole): boolean => canEditAnyAppModule(role);

export const canEditPrescriptions = (role: SupportedRole): boolean => canEditAnyAppModule(role);

export const canConfigurePrescriptions = (role: SupportedRole): boolean =>
  isAdminOrHospitalNurse(role);

export const canDeletePrescriptions = (role: SupportedRole): boolean =>
  isAdminOrHospitalNurse(role);

export const canPublishSpecialtyDecision = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));

export const canSetArbitraryAdmissionDate = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));

export const canManageFugaNotification = (role: SupportedRole): boolean => isAdmin(knownRole(role));

/** setAdminCudyrResult stays admin-only; nursing syncs CUDYR like the admin but does not set it. */
export const canSetAdminCudyrResult = (role: SupportedRole): boolean => isAdmin(knownRole(role));

/** The local error log of every person on this browser, not only one's own. */
export const canReadAllLocalDiagnostics = (role: SupportedRole): boolean =>
  isAdmin(knownRole(role));
