// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  canAccessSpecialAppModuleRoute,
  resolvePassiveBackupEditableModule,
} from '@/shared/access/operationalAccessPolicySupport';

describe('operationalAccessPolicySupport', () => {
  it('maps passive backup verification only for supported operational modules', () => {
    expect(resolvePassiveBackupEditableModule('CENSUS')).toBe('CENSUS');
    expect(resolvePassiveBackupEditableModule('NURSING_HANDOFF')).toBe('NURSING_HANDOFF');
    expect(resolvePassiveBackupEditableModule('MEDICAL_HANDOFF')).toBeNull();
  });

  it('resolves route overrides only for modules with special access handling', () => {
    expect(
      canAccessSpecialAppModuleRoute({
        module: 'AUDIT',
        isAuditAllowed: true,
        canManageBackupFiles: false,
        canUseAdminMaintenance: false,
        allowRoleManagementBootstrap: false,
      })
    ).toBe(true);

    expect(
      canAccessSpecialAppModuleRoute({
        module: 'ROLE_MANAGEMENT',
        isAuditAllowed: false,
        canManageBackupFiles: false,
        canUseAdminMaintenance: false,
        allowRoleManagementBootstrap: true,
      })
    ).toBe(true);

    expect(
      canAccessSpecialAppModuleRoute({
        module: 'CENSUS',
        isAuditAllowed: false,
        canManageBackupFiles: false,
        canUseAdminMaintenance: false,
        allowRoleManagementBootstrap: false,
      })
    ).toBeNull();
  });
});
