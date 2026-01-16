/**
 * Tests for audit.ts types and utilities
 * Tests the maskRut function for privacy protection
 */

import { describe, it, expect } from 'vitest';
import { maskRut, AuditAction } from '@/types/audit';

describe('audit types', () => {
    describe('maskRut', () => {
        it('should mask full RUT with verifier digit', () => {
            const masked = maskRut('12.345.678-9');
            expect(masked).toBe('12.345.***-*');
        });

        it('should mask RUT without dots', () => {
            const masked = maskRut('12345678-9');
            expect(masked).toBe('12345***-*');
        });

        it('should mask RUT with K verifier', () => {
            const masked = maskRut('12.345.678-K');
            expect(masked).toBe('12.345.***-*');
        });

        it('should return *** for empty string', () => {
            const masked = maskRut('');
            expect(masked).toBe('***');
        });

        it('should return *** for very short RUT', () => {
            const masked = maskRut('12');
            expect(masked).toBe('***');
        });

        it('should handle RUT without hyphen', () => {
            const masked = maskRut('123456789');
            expect(masked).toBe('12345***');
        });

        it('should handle undefined-like input', () => {
            const masked = maskRut(null as unknown as string);
            expect(masked).toBe('***');
        });

        it('should mask correctly for minimum valid length', () => {
            const masked = maskRut('1234');
            expect(masked.includes('***')).toBe(true);
        });

        it('should preserve first digits for longer RUTs', () => {
            const masked = maskRut('22.222.222-2');
            expect(masked.startsWith('22.222')).toBe(true);
        });
    });

    describe('AuditAction type', () => {
        it('should include patient actions', () => {
            const patientActions: AuditAction[] = [
                'PATIENT_ADMITTED',
                'PATIENT_DISCHARGED',
                'PATIENT_TRANSFERRED',
                'PATIENT_MODIFIED',
                'PATIENT_CLEARED',
            ];
            expect(patientActions).toHaveLength(5);
        });

        it('should include record actions', () => {
            const recordActions: AuditAction[] = [
                'DAILY_RECORD_DELETED',
                'DAILY_RECORD_CREATED',
            ];
            expect(recordActions).toHaveLength(2);
        });

        it('should include handoff actions', () => {
            const handoffActions: AuditAction[] = [
                'NURSE_HANDOFF_MODIFIED',
                'MEDICAL_HANDOFF_MODIFIED',
                'HANDOFF_NOVEDADES_MODIFIED',
                'MEDICAL_HANDOFF_SIGNED',
            ];
            expect(handoffActions).toHaveLength(4);
        });

        it('should include user actions', () => {
            const userActions: AuditAction[] = [
                'USER_LOGIN',
                'USER_LOGOUT',
            ];
            expect(userActions).toHaveLength(2);
        });

        it('should include view actions', () => {
            const viewActions: AuditAction[] = [
                'VIEW_PATIENT',
                'VIEW_CUDYR',
                'VIEW_NURSING_HANDOFF',
                'VIEW_MEDICAL_HANDOFF',
            ];
            expect(viewActions).toHaveLength(4);
        });

        it('should include bed actions', () => {
            const bedActions: AuditAction[] = [
                'BED_BLOCKED',
                'BED_UNBLOCKED',
                'EXTRA_BED_TOGGLED',
            ];
            expect(bedActions).toHaveLength(3);
        });

        it('should include system actions', () => {
            const systemActions: AuditAction[] = [
                'SYSTEM_ERROR',
                'DATA_IMPORTED',
                'DATA_EXPORTED',
            ];
            expect(systemActions).toHaveLength(3);
        });
    });
});
