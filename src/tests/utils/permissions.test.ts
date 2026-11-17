// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  canDoAction,
  canEditModule,
  getVisibleModules,
  isAdmin,
  canViewModule,
  ROLES,
} from '@/utils/permissions';

describe('permissions.ts - Security Critical Tests', () => {
  describe('isAdmin', () => {
    it('should return true for admin role', () => {
      expect(isAdmin(ROLES.ADMIN)).toBe(true);
    });

    it('should return false for non-admin roles', () => {
      expect(isAdmin(ROLES.NURSE_HOSPITAL)).toBe(false);
      expect(isAdmin(ROLES.DOCTOR_URGENCY)).toBe(false);
      expect(isAdmin(ROLES.VIEWER)).toBe(false);
    });

    it('should return false for undefined role', () => {
      expect(isAdmin(undefined)).toBe(false);
    });

    it('should return false for unknown role string', () => {
      expect(isAdmin('hacker')).toBe(false);
    });
  });

  describe('canEditModule - Security Gate', () => {
    it('admin should be able to edit all modules', () => {
      expect(canEditModule(ROLES.ADMIN, 'CENSUS')).toBe(true);
      expect(canEditModule(ROLES.ADMIN, 'CUDYR')).toBe(true);
      expect(canEditModule(ROLES.ADMIN, 'NURSING_HANDOFF')).toBe(true);
      expect(canEditModule(ROLES.ADMIN, 'MEDICAL_HANDOFF')).toBe(true);
      expect(canEditModule(ROLES.ADMIN, 'BACKUP_FILES')).toBe(true);
      expect(canEditModule(ROLES.ADMIN, 'AUDIT')).toBe(true);
    });

    it('nurse_hospital should edit CENSUS, CUDYR and NURSING_HANDOFF but not MEDICAL_HANDOFF', () => {
      expect(canEditModule(ROLES.NURSE_HOSPITAL, 'CENSUS')).toBe(true);
      expect(canEditModule(ROLES.NURSE_HOSPITAL, 'CUDYR')).toBe(true);
      expect(canEditModule(ROLES.NURSE_HOSPITAL, 'NURSING_HANDOFF')).toBe(true);
      expect(canEditModule(ROLES.NURSE_HOSPITAL, 'MEDICAL_HANDOFF')).toBe(false);
      // Should NOT edit these:
      expect(canEditModule(ROLES.NURSE_HOSPITAL, 'BACKUP_FILES')).toBe(false);
      expect(canEditModule(ROLES.NURSE_HOSPITAL, 'AUDIT')).toBe(false);
    });

    it('doctor_urgency should only edit MEDICAL_HANDOFF', () => {
      expect(canEditModule(ROLES.DOCTOR_URGENCY, 'CENSUS')).toBe(false);
      expect(canEditModule(ROLES.DOCTOR_URGENCY, 'CUDYR')).toBe(false);
      expect(canEditModule(ROLES.DOCTOR_URGENCY, 'NURSING_HANDOFF')).toBe(false);
      expect(canEditModule(ROLES.DOCTOR_URGENCY, 'MEDICAL_HANDOFF')).toBe(true);
    });

    it('doctor_specialist should only edit MEDICAL_HANDOFF', () => {
      expect(canEditModule(ROLES.DOCTOR_SPECIALIST, 'CENSUS')).toBe(false);
      expect(canEditModule(ROLES.DOCTOR_SPECIALIST, 'MEDICAL_HANDOFF')).toBe(true);
      expect(canEditModule(ROLES.DOCTOR_SPECIALIST, 'AUDIT')).toBe(false);
    });

    it('viewer should NOT edit anything', () => {
      expect(canEditModule(ROLES.VIEWER, 'CENSUS')).toBe(false);
    });

    it('undefined role should NOT edit anything', () => {
      expect(canEditModule(undefined, 'CENSUS')).toBe(false);
      expect(canEditModule(undefined, 'AUDIT')).toBe(false);
    });

    it('unknown role should NOT edit anything (security fallback)', () => {
      expect(canEditModule('unknown_role', 'CENSUS')).toBe(false);
      expect(canEditModule('unknown_role', 'AUDIT')).toBe(false);
    });
  });

  describe('getVisibleModules', () => {
    it('admin should see all modules', () => {
      const modules = getVisibleModules(ROLES.ADMIN);
      expect(modules).toContain('CENSUS');
      expect(modules).toContain('CUDYR');
      expect(modules).toContain('NURSING_HANDOFF');
      expect(modules).toContain('MEDICAL_HANDOFF');
      expect(modules).toContain('BACKUP_FILES');
      expect(modules).toContain('AUDIT');
    });

    it('nurse_hospital should see CENSUS, CUDYR, NURSING_HANDOFF and MEDICAL_HANDOFF', () => {
      const modules = getVisibleModules(ROLES.NURSE_HOSPITAL);
      expect(modules).toContain('CENSUS');
      expect(modules).toContain('CUDYR');
      expect(modules).toContain('NURSING_HANDOFF');
      expect(modules).toContain('MEDICAL_HANDOFF');
      expect(modules).not.toContain('BACKUP_FILES');
      expect(modules).not.toContain('AUDIT');
    });

    it('doctor_urgency should see CENSUS, NURSING_HANDOFF, MEDICAL_HANDOFF', () => {
      const modules = getVisibleModules(ROLES.DOCTOR_URGENCY);
      expect(modules).toContain('CENSUS');
      expect(modules).toContain('NURSING_HANDOFF');
      expect(modules).toContain('MEDICAL_HANDOFF');
      expect(modules).not.toContain('CUDYR');
      expect(modules).not.toContain('AUDIT');
    });

    it('viewer should only see CENSUS', () => {
      const modules = getVisibleModules(ROLES.VIEWER);
      expect(modules).toEqual(['CENSUS']);
    });

    it('doctor_specialist should only see CENSUS and MEDICAL_HANDOFF', () => {
      const modules = getVisibleModules(ROLES.DOCTOR_SPECIALIST);
      expect(modules).toEqual(['CENSUS', 'MEDICAL_HANDOFF']);
    });

    it('undefined role should default to CENSUS only', () => {
      const modules = getVisibleModules(undefined);
      expect(modules).toEqual(['CENSUS']);
    });
  });

  describe('canViewModule', () => {
    it('should return true if module is in visible list', () => {
      expect(canViewModule(ROLES.NURSE_HOSPITAL, 'CENSUS')).toBe(true);
      expect(canViewModule(ROLES.VIEWER, 'CENSUS')).toBe(true);
    });

    it('should return false if module is NOT in visible list', () => {
      expect(canViewModule(ROLES.VIEWER, 'AUDIT')).toBe(false);
      expect(canViewModule(ROLES.DOCTOR_URGENCY, 'CUDYR')).toBe(false);
    });
  });
});

// Module views and actions by role (formerly src/tests/integration/permissions.test.ts). Edit cases
// that repeated the canEditModule gate above stay there once.
describe('Permissions System (RBAC)', () => {
  describe('Admin Role', () => {
    const role = ROLES.ADMIN;

    it('should have access to all modules', () => {
      expect(canViewModule(role, 'CENSUS')).toBe(true);
      expect(canViewModule(role, 'CUDYR')).toBe(true);
      expect(canViewModule(role, 'AUDIT')).toBe(true);
      expect(canViewModule(role, 'WHATSAPP')).toBe(true);
    });

    it('should be allowed to perform critical admin actions', () => {
      expect(canDoAction(role, ACTIONS.RECORD_DELETE)).toBe(true);
      expect(canDoAction(role, ACTIONS.AUDIT_READ)).toBe(true);
      expect(canDoAction(role, ACTIONS.DEMO_DATA_GENERATE)).toBe(true);
    });
  });

  describe('Nurse Hospital Role', () => {
    const role = ROLES.NURSE_HOSPITAL;

    it('should have access to core clinical modules', () => {
      expect(canViewModule(role, 'CENSUS')).toBe(true);
      expect(canViewModule(role, 'CUDYR')).toBe(true);
      expect(canViewModule(role, 'NURSING_HANDOFF')).toBe(true);
    });

    it('should NOT have access to AUDIT or WHATSAPP config', () => {
      expect(canViewModule(role, 'AUDIT')).toBe(false);
      expect(canViewModule(role, 'WHATSAPP')).toBe(false);
    });

    it('should be allowed to delete records but NOT read audit logs', () => {
      expect(canDoAction(role, ACTIONS.RECORD_DELETE)).toBe(true);
      expect(canDoAction(role, ACTIONS.AUDIT_READ)).toBe(false);
    });

    it('should be allowed to discharge and transfer patients', () => {
      expect(canDoAction(role, ACTIONS.PATIENT_DISCHARGE)).toBe(true);
      expect(canDoAction(role, ACTIONS.PATIENT_TRANSFER)).toBe(true);
    });
  });

  describe('Doctor Urgency Role', () => {
    const role = ROLES.DOCTOR_URGENCY;

    it('should have limited module access', () => {
      expect(canViewModule(role, 'CENSUS')).toBe(true);
      expect(canViewModule(role, 'MEDICAL_HANDOFF')).toBe(true);
      expect(canViewModule(role, 'CUDYR')).toBe(false);
    });

    it('should be allowed to sign medical handoff', () => {
      expect(canDoAction(role, ACTIONS.HANDOFF_MEDICAL_SIGN)).toBe(true);
    });

    it('should NOT be allowed to write patient data or delete records', () => {
      expect(canDoAction(role, ACTIONS.PATIENT_WRITE)).toBe(false);
      expect(canDoAction(role, ACTIONS.RECORD_DELETE)).toBe(false);
    });
  });

  describe('Viewer Role', () => {
    it('should be strictly read-only', () => {
      expect(canEditModule(ROLES.VIEWER, 'CENSUS')).toBe(false);
      expect(canDoAction(ROLES.VIEWER, ACTIONS.PATIENT_WRITE)).toBe(false);
    });
  });

  describe('Guest / No Role', () => {
    it('should default to read-only censo access', () => {
      expect(canViewModule(undefined, 'CENSUS')).toBe(true);
      expect(canEditModule(undefined, 'CENSUS')).toBe(false);
      expect(canDoAction(undefined, ACTIONS.PATIENT_WRITE)).toBe(false);
    });
  });
});
