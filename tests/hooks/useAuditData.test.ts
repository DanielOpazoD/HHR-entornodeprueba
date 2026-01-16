import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuditData, AUDIT_SECTIONS } from '@/hooks/useAuditData';
import * as auditService from '@/services/admin/auditService';
import { AuditLogEntry } from '@/types/audit';

// Mock auditService
vi.mock('@/services/admin/auditService', () => ({
    getAuditLogs: vi.fn(),
    AUDIT_ACTION_LABELS: {
        'USER_LOGIN': 'Inicio de Sesión',
        'USER_LOGOUT': 'Cierre de Sesión',
        'PATIENT_ADMITTED': 'Paciente Ingresado',
        'PATIENT_DISCHARGED': 'Paciente Dado de Alta'
    }
}));

// Mock useAuditStats
vi.mock('@/hooks/useAuditStats', () => ({
    useAuditStats: vi.fn(() => ({
        totalLogs: 0,
        criticalLogs: 0,
        uniqueUsers: 0,
        actionBreakdown: {}
    }))
}));

describe('useAuditData', () => {
    const mockLogs: AuditLogEntry[] = [
        {
            id: '1',
            action: 'USER_LOGIN',
            userId: 'user1',
            timestamp: '2025-01-01T10:00:00Z',
            recordDate: '2025-01-01',
            entityType: 'user',
            entityId: 'user1',
            details: {}
        },
        {
            id: '2',
            action: 'PATIENT_ADMITTED',
            userId: 'user1',
            timestamp: '2025-01-01T11:00:00Z',
            recordDate: '2025-01-01',
            entityType: 'patient',
            entityId: 'R1',
            patientIdentifier: '12345678-9',
            details: { patientName: 'Juan Perez', rut: '12.345.678-9' }
        },
        {
            id: '3',
            action: 'PATIENT_DISCHARGED',
            userId: 'user2',
            timestamp: '2025-01-02T09:00:00Z',
            recordDate: '2025-01-02',
            entityType: 'patient',
            entityId: 'R1',
            patientIdentifier: '98765432-1',
            details: { patientName: 'Maria Lopez', rut: '98.765.432-1' }
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auditService.getAuditLogs).mockResolvedValue(mockLogs);
    });

    it('initializes with loading state and fetches logs', async () => {
        const { result } = renderHook(() => useAuditData());

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.logs).toHaveLength(3);
    });

    describe('Filtering', () => {
        it('filters by search term', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setSearchTerm('Juan');
            });

            expect(result.current.filteredLogs).toHaveLength(1);
            expect(result.current.filteredLogs[0].patientIdentifier).toBe('12345678-9');
        });

        it('filters by action type', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setFilterAction('USER_LOGIN');
            });

            expect(result.current.filteredLogs).toHaveLength(1);
            expect(result.current.filteredLogs[0].action).toBe('USER_LOGIN');
        });

        it('filters by RUT', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setSearchRut('123456789');
            });

            expect(result.current.filteredLogs).toHaveLength(1);
        });

        it('filters by date range', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setStartDate('2025-01-02');
                result.current.setEndDate('2025-01-02');
            });

            expect(result.current.filteredLogs).toHaveLength(1);
            expect(result.current.filteredLogs[0].recordDate).toBe('2025-01-02');
        });

        it('filters by section', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setActiveSection('SESSIONS');
            });

            expect(result.current.filteredLogs).toHaveLength(1);
            expect(result.current.filteredLogs[0].action).toBe('USER_LOGIN');
        });
    });

    describe('Pagination', () => {
        it('paginates logs correctly', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.currentPage).toBe(1);
            expect(result.current.totalPages).toBe(1); // 3 logs, 50 per page
        });

        it('resets page when filters change', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setCurrentPage(2);
            });

            expect(result.current.currentPage).toBe(2);

            act(() => {
                result.current.setSearchTerm('test');
            });

            await waitFor(() => {
                expect(result.current.currentPage).toBe(1);
            });
        });
    });

    describe('Row Expansion', () => {
        it('toggles row expansion', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.expandedRows.has('1')).toBe(false);

            act(() => {
                result.current.toggleRow('1');
            });

            expect(result.current.expandedRows.has('1')).toBe(true);

            act(() => {
                result.current.toggleRow('1');
            });

            expect(result.current.expandedRows.has('1')).toBe(false);
        });

        it('toggles metadata visibility', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.toggleMetadata('1');
            });

            expect(result.current.showMetadata.has('1')).toBe(true);
        });
    });

    describe('Grouped View', () => {
        it('groups logs when grouped view is enabled', async () => {
            const { result } = renderHook(() => useAuditData());

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                result.current.setGroupedView(true);
            });

            // Two users with different actions should create multiple groups
            expect(result.current.displayLogs.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('exports section definitions', () => {
        expect(AUDIT_SECTIONS.ALL).toBeDefined();
        expect(AUDIT_SECTIONS.SESSIONS).toBeDefined();
        expect(AUDIT_SECTIONS.CENSUS).toBeDefined();
    });
});
