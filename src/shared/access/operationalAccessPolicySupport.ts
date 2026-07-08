import type { ModuleType } from '@/constants/navigationConfig';

const PASSIVE_BACKUP_EDITABLE_MODULES = {
  CENSUS: 'CENSUS',
  NURSING_HANDOFF: 'NURSING_HANDOFF',
} as const satisfies Partial<Record<ModuleType, ModuleType>>;

const ADMIN_MAINTENANCE_MODULES = new Set<ModuleType>([
  'DATA_MAINTENANCE',
  'DIAGNOSTICS',
  'PATIENT_MASTER_INDEX',
  'REMINDERS',
]);

export const resolvePassiveBackupEditableModule = (
  moduleType: ModuleType | string
): ModuleType | null =>
  PASSIVE_BACKUP_EDITABLE_MODULES[moduleType as keyof typeof PASSIVE_BACKUP_EDITABLE_MODULES] ||
  null;

export const canAccessSpecialAppModuleRoute = ({
  module,
  isAuditAllowed,
  canManageBackupFiles,
  canUseAdminMaintenance,
  allowRoleManagementBootstrap,
}: {
  module: ModuleType;
  isAuditAllowed: boolean;
  canManageBackupFiles: boolean;
  canUseAdminMaintenance: boolean;
  allowRoleManagementBootstrap: boolean;
}): boolean | null => {
  if (module === 'AUDIT') {
    return isAuditAllowed;
  }

  if (module === 'BACKUP_FILES') {
    return canManageBackupFiles;
  }

  if (module === 'ROLE_MANAGEMENT') {
    return canUseAdminMaintenance || allowRoleManagementBootstrap;
  }

  if (ADMIN_MAINTENANCE_MODULES.has(module)) {
    return canUseAdminMaintenance;
  }

  return null;
};
