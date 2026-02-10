import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudit } from '@/hooks/useAudit';
import * as auditService from '@/services/admin/auditService';

// Mock the audit service
vi.mock('@/services/admin/auditService', () => ({
    logAuditEvent: vi.fn(),
    getAuditLogs: vi.fn().mockResolvedValue([]),
}));

describe('useAudit', () => {
    const testUserId = 'test-user-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return all audit functions', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        expect(typeof result.current.logPatientAdmission).toBe('function');
        expect(typeof result.current.logPatientDischarge).toBe('function');
        expect(typeof result.current.logPatientTransfer).toBe('function');
        expect(typeof result.current.logPatientCleared).toBe('function');
        expect(typeof result.current.logDailyRecordDeleted).toBe('function');
        expect(typeof result.current.logDailyRecordCreated).toBe('function');
        expect(typeof result.current.logPatientView).toBe('function');
        expect(typeof result.current.logEvent).toBe('function');
        expect(typeof result.current.logDebouncedEvent).toBe('function');
        expect(typeof result.current.fetchLogs).toBe('function');
        expect(typeof result.current.getActionLabel).toBe('function');
    });

    it('should log patient admission', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        act(() => {
            result.current.logPatientAdmission('R1', 'John Doe', '12345678-9', '2024-12-28');
        });

        expect(auditService.logAuditEvent).toHaveBeenCalledWith(
            testUserId,
            'PATIENT_ADMITTED',
            'patient',
            'R1',
            expect.objectContaining({ patientName: 'John Doe' }),
            '12345678-9',
            '2024-12-28',
            undefined
        );
    });

    it('should log patient discharge', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        act(() => {
            result.current.logPatientDischarge('R1', 'John Doe', '12345678-9', 'Vivo', '2024-12-28');
        });

        expect(auditService.logAuditEvent).toHaveBeenCalledWith(
            testUserId,
            'PATIENT_DISCHARGED',
            'discharge',
            'R1',
            expect.objectContaining({ patientName: 'John Doe', status: 'Vivo' }),
            '12345678-9',
            '2024-12-28',
            undefined
        );
    });

    it('should log patient transfer', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        act(() => {
            result.current.logPatientTransfer('R1', 'John Doe', '12345678-9', 'Hospital X', '2024-12-28');
        });

        expect(auditService.logAuditEvent).toHaveBeenCalledWith(
            testUserId,
            'PATIENT_TRANSFERRED',
            'transfer',
            'R1',
            expect.objectContaining({ destination: 'Hospital X' }),
            '12345678-9',
            '2024-12-28',
            undefined
        );
    });

    it('should log patient cleared', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        act(() => {
            result.current.logPatientCleared('R1', 'John Doe', '12345678-9', '2024-12-28');
        });

        expect(auditService.logAuditEvent).toHaveBeenCalled();
    });

    it('should log daily record deleted', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        act(() => {
            result.current.logDailyRecordDeleted('2024-12-28');
        });

        expect(auditService.logAuditEvent).toHaveBeenCalledWith(
            testUserId,
            'DAILY_RECORD_DELETED',
            'dailyRecord',
            '2024-12-28',
            expect.objectContaining({ date: '2024-12-28' }),
            undefined,
            '2024-12-28',
            undefined
        );
    });

    it('should log daily record created', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        act(() => {
            result.current.logDailyRecordCreated('2024-12-28', '2024-12-27');
        });

        expect(auditService.logAuditEvent).toHaveBeenCalledWith(
            testUserId,
            'DAILY_RECORD_CREATED',
            'dailyRecord',
            '2024-12-28',
            expect.objectContaining({ copiedFrom: '2024-12-27' }),
            undefined,
            '2024-12-28',
            undefined
        );
    });

    it('should fetch logs', async () => {
        const { result } = renderHook(() => useAudit(testUserId));

        await act(async () => {
            await result.current.fetchLogs(50);
        });

        expect(auditService.getAuditLogs).toHaveBeenCalledWith(50);
    });

    it('should get action label', () => {
        const { result } = renderHook(() => useAudit(testUserId));

        const label = result.current.getActionLabel('PATIENT_ADMITTED');
        expect(typeof label).toBe('string');
    });
});
