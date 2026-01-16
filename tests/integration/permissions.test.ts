/**
 * Integration Tests for Permissions (RBAC) System
 * Validates module-level and action-level permissions for all user roles.
 */

import { describe, it, expect } from 'vitest';
import {
    canEditModule,
    canViewModule,
    canDoAction,
    ROLES,
    ACTIONS
} from '../../utils/permissions';

describe('Permissions System (RBAC)', () => {

    describe('Admin Role', () => {
        const role = ROLES.ADMIN;

        it('should have access to all modules', () => {
            expect(canViewModule(role, 'CENSUS')).toBe(true);
            expect(canViewModule(role, 'CUDYR')).toBe(true);
            expect(canViewModule(role, 'AUDIT')).toBe(true);
            expect(canViewModule(role, 'WHATSAPP')).toBe(true);
        });

        it('should have edit permissions for all modules', () => {
            expect(canEditModule(role, 'CENSUS')).toBe(true);
            expect(canEditModule(role, 'AUDIT')).toBe(true);
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

        it('should have edit permissions for clinical modules', () => {
            expect(canEditModule(role, 'CENSUS')).toBe(true);
            expect(canEditModule(role, 'CUDYR')).toBe(true);
        });

        it('should NOT be allowed to delete records or read audit logs', () => {
            expect(canDoAction(role, ACTIONS.RECORD_DELETE)).toBe(false);
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

        it('should be READ-ONLY for all clinical modules', () => {
            expect(canEditModule(role, 'CENSUS')).toBe(false);
            expect(canEditModule(role, 'NURSING_HANDOFF')).toBe(false);
        });

        it('should be allowed to sign medical handoff', () => {
            expect(canDoAction(role, ACTIONS.HANDOFF_MEDICAL_SIGN)).toBe(true);
        });

        it('should NOT be allowed to write patient data or delete records', () => {
            expect(canDoAction(role, ACTIONS.PATIENT_WRITE)).toBe(false);
            expect(canDoAction(role, ACTIONS.RECORD_DELETE)).toBe(false);
        });
    });

    describe('Viewer Census Role', () => {
        const role = ROLES.VIEWER_CENSUS;

        it('should only see CENSUS module', () => {
            expect(canViewModule(role, 'CENSUS')).toBe(true);
            expect(canViewModule(role, 'AUDIT')).toBe(false);
            expect(canViewModule(role, 'TRANSFER_MANAGEMENT')).toBe(false);
        });

        it('should be strictly read-only', () => {
            expect(canEditModule(role, 'CENSUS')).toBe(false);
            expect(canDoAction(role, ACTIONS.PATIENT_WRITE)).toBe(false);
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
