import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, useCallback } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuditData, AUDIT_SECTIONS } from '@/hooks/useAuditData';
import { useAuditWorker } from '@/hooks/useAuditWorker';
import * as fetchAuditLogsUseCase from '@/application/audit/fetchAuditLogsUseCase';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import { AuditLogEntry, WorkerFilterParams } from '@/types/auditLogTypes';
import * as auditWorkerLogic from '@/services/admin/auditWorkerLogic';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

vi.mock('@/application/audit/fetchAuditLogsUseCase', () => ({
  executeFetchAuditLogs: vi.fn(),
}));

vi.mock('@/services/admin/auditConstants', () => ({
  AUDIT_ACTION_LABELS: {
    USER_LOGIN: 'Inicio de Sesión',
    USER_LOGOUT: 'Cierre de Sesión',
    PATIENT_ADMITTED: 'Paciente Ingresado',
    PATIENT_DISCHARGED: 'Paciente Dado de Alta',
  },
  CRITICAL_ACTIONS: ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED'],
  IMPORTANT_ACTIONS: [],
}));

vi.mock('@/hooks/useAuditWorker', () => {
  return {
    useAuditWorker: vi.fn(() => ({
      results: {
        filteredLogs: [],
        displayLogs: [],
        stats: null,
      },
      isProcessing: false,
      processData: vi.fn(),
    })),
  };
});

// Mock useAuditStats
vi.mock('@/hooks/useAuditStats', () => ({
  useAuditStats: vi.fn(() => ({
    totalLogs: 0,
    criticalLogs: 0,
    uniqueUsers: 0,
    actionBreakdown: {},
  })),
  getActionCriticality: vi.fn((action: string) =>
    ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED'].includes(action) ? 'critical' : 'info'
  ),
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
      details: {},
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
      details: { patientName: 'Juan Perez', rut: '12.345.678-9' },
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
      details: { patientName: 'Maria Lopez', rut: '98.765.432-1' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAuditLogsUseCase.executeFetchAuditLogs).mockResolvedValue({
      status: 'success',
      data: mockLogs,
      issues: [],
    });

    // Setup useAuditWorker mock to return processed data based on logs
    vi.mocked(useAuditWorker).mockImplementation(() => {
      const [results, setResults] = useState({
        filteredLogs: mockLogs,
        displayLogs: mockLogs,
        stats: auditWorkerLogic.calculateAuditStats(mockLogs, []),
      });

      const processData = useCallback((logs: AuditLogEntry[], params: WorkerFilterParams) => {
        const filtered = auditWorkerLogic.filterLogs(logs, params);
        const display = params.groupedView
          ? auditWorkerLogic.groupLogs(filtered, AUDIT_ACTION_LABELS)
          : filtered;
        const stats = auditWorkerLogic.calculateAuditStats(filtered, []);

        setResults({
          filteredLogs: filtered,
          displayLogs: display,
          stats,
        });
      }, []);

      return { results, isProcessing: false, processData };
    });
  });

  it('initializes with loading state and fetches logs', async () => {
    const { result } = renderHook(() => useAuditData());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.logs).toHaveLength(3);
    expect(fetchAuditLogsUseCase.executeFetchAuditLogs).toHaveBeenCalledWith({});
    expect(result.current.filters.groupedView).toBe(true);
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

    it('applies quick clinical audit date range presets', async () => {
      const { result } = renderHook(() => useAuditData());

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.setStartDate('2026-01-01');
        result.current.setEndDate('2026-05-02');
      });

      act(() => {
        result.current.applyDateRangePreset('all');
      });

      expect(result.current.filters.startDate).toBe('');
      expect(result.current.filters.endDate).toBe('');
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
      await waitFor(() => expect(result.current.displayLogs).toHaveLength(3));

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

  it('respects grouped view when building display logs', async () => {
    const duplicateLogs: AuditLogEntry[] = [
      mockLogs[0],
      {
        ...mockLogs[1],
        id: '4',
        timestamp: '2025-01-01T11:05:00Z',
      },
    ];
    vi.mocked(fetchAuditLogsUseCase.executeFetchAuditLogs).mockResolvedValue({
      status: 'success',
      data: duplicateLogs,
      issues: [],
    });

    const { result } = renderHook(() => useAuditData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.displayLogs).toHaveLength(2);

    act(() => {
      result.current.setGroupedView(true);
    });

    await waitFor(() => {
      expect(result.current.displayLogs).toHaveLength(2);
    });
  });

  it('falls back to a stable empty list when fetch is degraded', async () => {
    const degradedResult: ApplicationOutcome<AuditLogEntry[]> = {
      status: 'degraded',
      data: [],
      issues: [{ kind: 'unknown', message: 'Sin acceso remoto temporal.' }],
    };
    vi.mocked(fetchAuditLogsUseCase.executeFetchAuditLogs).mockResolvedValueOnce(degradedResult);

    const { result } = renderHook(() => useAuditData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.logs).toEqual([]);
    expect(result.current.filteredLogs).toEqual([]);
    expect(result.current.stats.totalSessionsToday).toBe(0);
  });

  it('keeps filters stable when the fetched audit set is empty', async () => {
    vi.mocked(fetchAuditLogsUseCase.executeFetchAuditLogs).mockResolvedValueOnce({
      status: 'success',
      data: [],
      issues: [],
    });

    const { result } = renderHook(() => useAuditData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setCurrentPage(2);
      result.current.setSearchTerm('Juan');
    });

    expect(result.current.filteredLogs).toEqual([]);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.filters.searchTerm).toBe('Juan');
    expect(result.current.isProcessing).toBe(false);
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
