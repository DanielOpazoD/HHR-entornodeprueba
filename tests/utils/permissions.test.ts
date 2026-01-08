import { describe, it, expect } from 'vitest';
import { canEditModule, getVisibleModules, isAdmin, canViewModule, ROLES } from '@/utils/permissions';

describe('permissions.ts - Security Critical Tests', () => {
    describe('isAdmin', () => {
        it('should return true for admin role', () => {
            expect(isAdmin(ROLES.ADMIN)).toBe(true);
        });

        it('should return false for non-admin roles', () => {
            expect(isAdmin(ROLES.NURSE_HOSPITAL)).toBe(false);
            expect(isAdmin(ROLES.DOCTOR_URGENCY)).toBe(false);
            expect(isAdmin(ROLES.VIEWER_CENSUS)).toBe(false);
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
            expect(canEditModule(ROLES.ADMIN, 'TRANSFER_MANAGEMENT')).toBe(true);
            expect(canEditModule(ROLES.ADMIN, 'BACKUP_FILES')).toBe(true);
            expect(canEditModule(ROLES.ADMIN, 'AUDIT')).toBe(true);
        });

        it('nurse_hospital should edit CENSUS, CUDYR, NURSING_HANDOFF only', () => {
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'CENSUS')).toBe(true);
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'CUDYR')).toBe(true);
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'NURSING_HANDOFF')).toBe(true);
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'TRANSFER_MANAGEMENT')).toBe(true);
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'BACKUP_FILES')).toBe(true);
            // Should NOT edit these:
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'MEDICAL_HANDOFF')).toBe(false);
            expect(canEditModule(ROLES.NURSE_HOSPITAL, 'AUDIT')).toBe(false);
        });

        it('doctor_urgency should NOT edit anything (read-only)', () => {
            expect(canEditModule(ROLES.DOCTOR_URGENCY, 'CENSUS')).toBe(false);
            expect(canEditModule(ROLES.DOCTOR_URGENCY, 'CUDYR')).toBe(false);
            expect(canEditModule(ROLES.DOCTOR_URGENCY, 'NURSING_HANDOFF')).toBe(false);
            expect(canEditModule(ROLES.DOCTOR_URGENCY, 'MEDICAL_HANDOFF')).toBe(false);
        });

        it('viewer_census should NOT edit anything', () => {
            expect(canEditModule(ROLES.VIEWER_CENSUS, 'CENSUS')).toBe(false);
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
            expect(modules).toContain('TRANSFER_MANAGEMENT');
            expect(modules).toContain('BACKUP_FILES');
            expect(modules).toContain('AUDIT');
        });

        it('nurse_hospital should see CENSUS, CUDYR, NURSING_HANDOFF, MEDICAL_HANDOFF, REPORTS', () => {
            const modules = getVisibleModules(ROLES.NURSE_HOSPITAL);
            expect(modules).toContain('CENSUS');
            expect(modules).toContain('CUDYR');
            expect(modules).toContain('NURSING_HANDOFF');
            expect(modules).toContain('MEDICAL_HANDOFF');
            expect(modules).toContain('TRANSFER_MANAGEMENT');
            expect(modules).toContain('BACKUP_FILES');
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

        it('viewer_census should only see CENSUS', () => {
            const modules = getVisibleModules(ROLES.VIEWER_CENSUS);
            expect(modules).toEqual(['CENSUS']);
        });

        it('undefined role should default to CENSUS only', () => {
            const modules = getVisibleModules(undefined);
            expect(modules).toEqual(['CENSUS']);
        });
    });

    describe('canViewModule', () => {
        it('should return true if module is in visible list', () => {
            expect(canViewModule(ROLES.NURSE_HOSPITAL, 'CENSUS')).toBe(true);
            expect(canViewModule(ROLES.VIEWER_CENSUS, 'CENSUS')).toBe(true);
        });

        it('should return false if module is NOT in visible list', () => {
            expect(canViewModule(ROLES.VIEWER_CENSUS, 'AUDIT')).toBe(false);
            expect(canViewModule(ROLES.DOCTOR_URGENCY, 'CUDYR')).toBe(false);
        });
    });
});
